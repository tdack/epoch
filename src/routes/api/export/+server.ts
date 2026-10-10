import { apiHandler } from '#lib/server/http/handler.js';
import { downloadHeaders } from '#lib/server/http/export-download.js';
import { ExportExpiredError, ExportUnavailableError } from '#lib/server/domain/errors.js';
import type { R2Bucket } from '@cloudflare/workers-types';
import { assertExportable, GedcomService } from '#lib/server/services/gedcom-service.js';
import { DEFAULT_GEDCOM_FORMAT, type GedcomFormat } from '#lib/server/gedcom/tags.js';
import { exportBodySchema, exportQuerySchema } from '#lib/server/validation/schemas.js';
import {
	buildExportInstanceId,
	EXPORT_STATES,
	exportObjectKey,
	exportWriteTime,
	isExportExpired,
	mapWorkflowStatus,
	parseExportInstanceId
} from '#lib/server/workflows/export-instance.js';

/*
 * TODO(audit): an export writes no audit entry yet. It does not fit `change_log`, which ADR-007
 * scopes to tree content for undo (an import logs nothing for the same reason), and whose
 * `changes_json` is a list of per-record before/after images with no room for a format, a mode or
 * an instance id. Recording who exported what, when, sync or async, and the instance id needs a
 * dedicated account-level audit entry — a new table and migration, which is a hard gate and is not
 * opened here. Write one entry where each path produces the file: the synchronous GET, and the
 * workflow step (keyed by the instance id).
 */

/**
 * Above this many people an export runs asynchronously in the workflow; at or below it the POST
 * answers `sync` and the browser downloads through the GET below.
 */
const LARGE_EXPORT_INDIVIDUALS = 5000;
/** The most a synchronous download will ever build, whether or not a workflow is bound. */
const MAX_SYNC_EXPORT_INDIVIDUALS = 50000;

/**
 * How long the runtime keeps the instance. Deliberately longer than the object's 24-hour window:
 * the client reads the file through the instance, so an instance purged first would strand a file
 * that is still downloadable. Success outlives the file (3 days); an errored instance is kept a
 * week for diagnosis. This wins over the binding's `default_retention`, which only applies to an
 * instance created without one — and this route always passes one.
 */
const EXPORT_INSTANCE_RETENTION = { successRetention: '3 days', errorRetention: '7 days' };

const options = { failure: 'Export failed', messagePrefix: 'Export failed: ' };

/** Best-effort delete of an object whose instance is gone: the lifecycle rule is the backstop. */
async function discard(bucket: R2Bucket, fileKey: string): Promise<void> {
	try {
		await bucket.delete(fileKey);
	} catch {
		// The object is beyond use whether or not the delete lands, so the answer is unchanged.
	}
}

function resolveFormat(raw: string | null): GedcomFormat {
	return raw === 'gedcom551' || raw === 'gedcom7' ? raw : DEFAULT_GEDCOM_FORMAT;
}

export const GET = apiHandler(
	{ ...options, query: exportQuerySchema },
	async ({ db, ctx, event, query }) => {
		const { treeId } = query;
		const env = event.platform?.env;
		const service = new GedcomService(db);
		await service.requireExport(treeId, ctx);

		// The download is built in this request, so the size decides before any of it is read. The
		// ceiling is checked first, whatever is bound: a tree too large for any synchronous build is
		// refused outright, so a bound workflow cannot turn that refusal into a 409 instead. Below the
		// ceiling, a large tree goes through the workflow when one is bound; a small one never does.
		const count = await service.countIndividuals(treeId);
		if (count > MAX_SYNC_EXPORT_INDIVIDUALS) {
			return Response.json(
				{ error: 'This tree is too large for a direct download', code: 'sync_export_too_large' },
				{ status: 413 }
			);
		}
		if (env?.GEDCOM_EXPORT_WORKFLOW && count > LARGE_EXPORT_INDIVIDUALS) {
			return Response.json(
				{ error: 'This tree is too large to download directly', code: 'use_async' },
				{ status: 409 }
			);
		}

		const { content, filename, contentType } = await service.exportDownload(
			treeId,
			{
				format: resolveFormat(query.format ?? null),
				shouldCompress: query.package === 'gdz'
			},
			ctx
		);
		return new Response(content, {
			status: 200,
			headers: downloadHeaders(filename, contentType, typeof content === 'string')
		});
	}
);

export const POST = apiHandler(
	{ ...options, body: exportBodySchema },
	async ({ db, ctx, event, body }) => {
		const { treeId, clientUuid } = body;
		const format = resolveFormat(body.format ?? null);
		const shouldCompress = body.shouldCompress ?? false;
		assertExportable({ format, shouldCompress });

		const env = event.platform?.env;
		const bucket = env?.MEDIA_BUCKET;
		const service = new GedcomService(db, { bucket });
		await service.requireExport(treeId, ctx);

		// The size decides before the binding does: a tree small enough to build in the request is
		// always answered `sync`, so it works even with no workflow bound. A tree past the
		// synchronous ceiling cannot be built here and must not start a workflow either — it would
		// only OOM and retry — so it is refused outright.
		const count = await service.countIndividuals(treeId);
		if (count <= LARGE_EXPORT_INDIVIDUALS) return { status: 'sync' };
		if (count > MAX_SYNC_EXPORT_INDIVIDUALS) {
			return Response.json(
				{ error: 'This tree is too large to export', code: 'export_too_large' },
				{ status: 413 }
			);
		}

		// Only now is a workflow needed: above the small threshold and within the ceiling. Without
		// the binding there is nothing to run the async half, and there is no sync fallback.
		const workflow = env?.GEDCOM_EXPORT_WORKFLOW;
		if (!workflow) return Response.json({ status: 'unavailable' }, { status: 503 });

		// The id is built server-side from the tree, the format and the client's per-click uuid, so a
		// retry names the same instance and a download can derive the object key from it. The key
		// itself is never returned.
		const instanceId = buildExportInstanceId(treeId, format, shouldCompress, clientUuid);
		try {
			await workflow.create({
				id: instanceId,
				params: { treeId, userId: ctx.user.id, format, shouldCompress },
				retention: EXPORT_INSTANCE_RETENTION
			});
		} catch {
			// `create` fails for a handful of reasons; the common one is that this exact id already
			// exists (the client retried, or two clicks raced). Prove it by reading that same id back —
			// never a client-supplied one — and only an instance that parses to our id counts. The
			// failure's text is never inspected, and nothing is restarted: for a retry-safe client id,
			// "already there" and "started now" are the same.
			const existing = await workflow.get(instanceId).catch(() => null);
			const parsed =
				existing && existing.id === instanceId ? parseExportInstanceId(existing.id) : null;
			const runtimeStatus = existing ? await existing.status().catch(() => null) : null;
			if (!parsed || !runtimeStatus) throw new ExportUnavailableError();
			const state = mapWorkflowStatus(runtimeStatus.status);
			if (state === EXPORT_STATES.errored) throw new ExportUnavailableError();
			// A finished instance is only usable while its file is still there and within its window.
			// An instance whose file is gone or aged out can never be downloaded, so it must not be
			// answered as started; the object, if it lingers, is cleared now.
			if (state === EXPORT_STATES.complete) {
				if (!bucket) throw new ExportUnavailableError();
				const fileKey = exportObjectKey(parsed.treeId, parsed.token, parsed.clientUuid);
				const object = await bucket.head(fileKey).catch(() => null);
				if (!object || isExportExpired(exportWriteTime(object))) {
					if (object) await discard(bucket, fileKey);
					throw new ExportExpiredError();
				}
			}
		}
		return { status: 'started', instanceId };
	}
);
