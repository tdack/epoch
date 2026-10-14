import { apiHandler } from '#lib/server/http/handler.js';
import { downloadHeaders } from '#lib/server/http/export-download.js';
import type { R2Bucket, R2ObjectBody, WorkflowInstance } from '@cloudflare/workers-types';
import {
	ExportExpiredError,
	ExportUnavailableError,
	NotFoundError
} from '#lib/server/domain/errors.js';
import { GEDCOM_CONTENT_TYPE, GedcomService } from '#lib/server/services/gedcom-service.js';
import { GEDZIP_CONTENT_TYPE } from '#lib/server/gedcom/gedzip.js';
import {
	EXPORT_CODES,
	EXPORT_STATES,
	exportObjectKey,
	exportWriteTime,
	isExportExpired,
	mapWorkflowStatus,
	matchesExportKey,
	type ExportState,
	type ParsedExportInstance
} from '#lib/server/workflows/export-instance.js';

const options = { failure: 'Export failed' };

/** Best-effort delete of an expired object: the lifecycle rule is the backstop if it fails. */
async function discard(bucket: R2Bucket, fileKey: string): Promise<void> {
	try {
		await bucket.delete(fileKey);
	} catch {
		// The object is past its window whether or not the delete lands, so the answer is unchanged.
	}
}

/**
 * Remove an object whose instance is gone. An instance can be purged independently of its file
 * (an operator, a deployment, a shorter retention than this app asks for), which would otherwise
 * strand the object until the lifecycle rule runs. Best effort, and the key comes from the parsed
 * id, never the client. The lifecycle rule is the backstop if the head or delete fails.
 */
async function discardOrphan(bucket: R2Bucket, parsed: ParsedExportInstance): Promise<void> {
	try {
		const fileKey = exportObjectKey(parsed.treeId, parsed.token, parsed.clientUuid);
		if (await bucket.head(fileKey)) await bucket.delete(fileKey);
	} catch {
		// The lifecycle rule is the backstop if the head or delete fails.
	}
}

/**
 * The finished file of an asynchronous export. It streams only a complete export, derives the
 * object key from the instance id (never from the client), and re-checks the retention window at
 * read time, because the lifecycle rule is a backstop and not a guarantee.
 */
export const GET = apiHandler(
	{ ...options, params: ['instanceId'] },
	async ({ db, ctx, event, params }) => {
		const env = event.platform?.env;
		const bucket = env?.MEDIA_BUCKET;
		const workflow = env?.GEDCOM_EXPORT_WORKFLOW;
		if (!bucket || !workflow) throw new ExportUnavailableError();

		// Authorization first, before the workflow or R2 is touched.
		const parsed = await new GedcomService(db).requireExportInstance(params.instanceId, ctx);

		let instance: WorkflowInstance;
		try {
			instance = await workflow.get(params.instanceId);
		} catch {
			// The runtime no longer knows the instance: it has been purged. Its file, if the workflow
			// wrote one, is now an orphan, so clear it before answering the same 404.
			await discardOrphan(bucket, parsed);
			throw new NotFoundError('Export');
		}

		let state: ExportState;
		try {
			state = mapWorkflowStatus((await instance.status()).status);
		} catch {
			throw new NotFoundError('Export');
		}
		if (state !== EXPORT_STATES.complete) {
			// Not ready: answer with the status the client would poll, never a partial or empty file.
			return Response.json({ status: state, code: EXPORT_CODES[state] }, { status: 409 });
		}

		const fileKey = exportObjectKey(parsed.treeId, parsed.token, parsed.clientUuid);
		// Derived from the instance id, so this only guards against the two ever drifting apart.
		if (!matchesExportKey(fileKey, parsed)) throw new NotFoundError('Export');

		let object: R2ObjectBody | null;
		try {
			object = await bucket.get(fileKey);
		} catch {
			throw new ExportUnavailableError();
		}
		if (!object) throw new NotFoundError('Export');
		if (isExportExpired(exportWriteTime(object))) {
			await discard(bucket, fileKey);
			throw new ExportExpiredError();
		}

		// Derived from the instance, never the stored type: the object's metadata is a write-time
		// input, and a file served as HTML would be rendered by the browser instead of downloaded.
		const contentType = parsed.shouldCompress ? GEDZIP_CONTENT_TYPE : GEDCOM_CONTENT_TYPE;
		const filename = storedFilename(object.httpMetadata?.contentDisposition, parsed);
		return new Response(object.body as unknown as ReadableStream, {
			status: 200,
			headers: downloadHeaders(filename, contentType, !parsed.shouldCompress)
		});
	}
);

/** The download name the object was stored with, or a typed name if that metadata is gone. */
function storedFilename(disposition: string | undefined, parsed: ParsedExportInstance): string {
	const match = disposition?.match(/filename="([^"]*)"/);
	return match?.[1] || `export.${parsed.shouldCompress ? 'gdz' : 'ged'}`;
}
