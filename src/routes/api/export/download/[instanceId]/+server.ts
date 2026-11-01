import { apiHandler } from '#lib/server/http/handler.js';
import { downloadHeaders } from '#lib/server/http/export-download.js';
import { deleteExport, openSegmentedExport } from '#lib/server/http/export-storage.js';
import type { R2ObjectBody, WorkflowInstance } from '@cloudflare/workers-types';
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
			await deleteExport(bucket, parsed);
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

		if (parsed.shouldIncludeMedia) {
			// Segments are streamed in order and never merged; the length is their sum.
			let segmented: Awaited<ReturnType<typeof openSegmentedExport>>;
			try {
				segmented = await openSegmentedExport(bucket, parsed);
			} catch (err) {
				if (err instanceof NotFoundError || err instanceof ExportExpiredError) throw err;
				throw new ExportUnavailableError();
			}
			const headers = downloadHeaders(segmented.filename, GEDZIP_CONTENT_TYPE, false);
			headers.set('Content-Length', String(segmented.length));
			return new Response(segmented.body, { status: 200, headers });
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
			await deleteExport(bucket, parsed, true);
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
