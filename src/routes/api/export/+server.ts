import { apiHandler } from '#lib/server/http/handler.js';
import { ExportUnavailableError } from '#lib/server/domain/errors.js';
import { assertExportable, GedcomService } from '#lib/server/services/gedcom-service.js';
import { DEFAULT_GEDCOM_FORMAT, type GedcomFormat } from '#lib/server/gedcom/tags.js';
import { exportBodySchema } from '#lib/server/validation/schemas.js';
import {
	buildExportInstanceId,
	EXPORT_STATES,
	mapWorkflowStatus,
	parseExportInstanceId
} from '#lib/server/workflows/export-instance.js';

/**
 * Above this many people an export runs asynchronously in the workflow; at or below it the POST
 * answers `sync` and the browser downloads through the GET below.
 */
const LARGE_EXPORT_INDIVIDUALS = 5000;
/** The most a synchronous download will ever build, whether or not a workflow is bound. */
const MAX_SYNC_EXPORT_INDIVIDUALS = 50000;

const options = { failure: 'Export failed', messagePrefix: 'Export failed: ' };

function resolveFormat(raw: string | null): GedcomFormat {
	return raw === 'gedcom551' || raw === 'gedcom7' ? raw : DEFAULT_GEDCOM_FORMAT;
}

/**
 * The one body every export download is served with. Private and non-sniffable: the file holds
 * living people (ADR-015), and a browser must never cache it or second-guess its type. The name is
 * sent twice, an ASCII `filename` for old clients and an RFC 5987 `filename*` for the real one.
 */
function downloadHeaders(filename: string, contentType: string, isText: boolean): Headers {
	const headers = new Headers();
	headers.set('Content-Type', isText ? `${contentType}; charset=utf-8` : contentType);
	headers.set('Content-Disposition', attachmentDisposition(filename));
	headers.set('Cache-Control', 'private, no-store');
	headers.set('X-Content-Type-Options', 'nosniff');
	return headers;
}

/** An ASCII `filename` plus an RFC 5987 `filename*`, so a name with spaces or non-ASCII survives. */
function attachmentDisposition(filename: string): string {
	const ascii = filename.replace(/[^\x20-\x7e]|["\\]/g, '_');
	return `attachment; filename="${ascii}"; filename*=UTF-8''${rfc5987Encode(filename)}`;
}

/** Encode a value for RFC 5987's `ext-value`; `encodeURIComponent` leaves `'()*` unescaped, which are not attr-chars. */
function rfc5987Encode(value: string): string {
	return encodeURIComponent(value).replace(
		/['()*]/g,
		(character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`
	);
}

export const GET = apiHandler(options, async ({ db, ctx, event, url }) => {
	const treeId = url.searchParams.get('treeId');
	if (!treeId) {
		return Response.json({ error: 'treeId query parameter required' }, { status: 400 });
	}
	const env = event.platform?.env;
	const service = new GedcomService(db);
	await service.requireExport(treeId, ctx);

	// The download is built in this request, so the size decides before any of it is read: a large
	// tree must go through the workflow when one is bound, and is refused outright when it is too
	// large for any synchronous build.
	const count = await service.countIndividuals(treeId);
	if (env?.GEDCOM_EXPORT_WORKFLOW && count > LARGE_EXPORT_INDIVIDUALS) {
		return Response.json(
			{ error: 'This tree is too large to download directly', code: 'use_async' },
			{ status: 409 }
		);
	}
	if (count > MAX_SYNC_EXPORT_INDIVIDUALS) {
		return Response.json(
			{ error: 'This tree is too large for a direct download', code: 'sync_export_too_large' },
			{ status: 413 }
		);
	}

	const { content, filename, contentType } = await service.exportDownload(
		treeId,
		{
			format: resolveFormat(url.searchParams.get('format')),
			shouldCompress: url.searchParams.get('package') === 'gdz'
		},
		ctx
	);
	return new Response(content, {
		status: 200,
		headers: downloadHeaders(filename, contentType, typeof content === 'string')
	});
});

export const POST = apiHandler(
	{ ...options, body: exportBodySchema },
	async ({ db, ctx, event, body }) => {
		const { treeId, clientUuid } = body;
		const format = resolveFormat(body.format ?? null);
		const shouldCompress = body.shouldCompress ?? false;
		assertExportable({ format, shouldCompress });

		const env = event.platform?.env;
		const service = new GedcomService(db, { bucket: env?.MEDIA_BUCKET });
		await service.requireExport(treeId, ctx);

		// Without the workflow there is nothing to run the async half and the sync half is reached
		// only after this answer says `sync`; the client shows this and does not fall back.
		const workflow = env?.GEDCOM_EXPORT_WORKFLOW;
		if (!workflow) return Response.json({ status: 'unavailable' }, { status: 503 });

		const count = await service.countIndividuals(treeId);
		if (count <= LARGE_EXPORT_INDIVIDUALS) return { status: 'sync' };

		// The id is built server-side from the tree, the format and the client's per-click uuid, so a
		// retry names the same instance and a download can derive the object key from it. The key
		// itself is never returned.
		const instanceId = buildExportInstanceId(treeId, format, shouldCompress, clientUuid);
		try {
			await workflow.create({
				id: instanceId,
				params: { treeId, userId: ctx.user.id, format, shouldCompress },
				retention: { successRetention: '1 day', errorRetention: '1 day' }
			});
		} catch {
			// `create` fails for a handful of reasons; the common one is that this exact id already
			// exists (the client retried, or two clicks raced). Prove it by reading that same id back —
			// never a client-supplied one — and only an instance that parses to our id and has not
			// errored counts as already running. The failure's text is never inspected, and nothing is
			// restarted: for a retry-safe client id, "already there" and "started now" are the same.
			const existing = await workflow.get(instanceId).catch(() => null);
			const roundTrip = existing ? parseExportInstanceId(existing.id) : null;
			const status = existing ? await existing.status().catch(() => null) : null;
			const isLiveExisting =
				existing !== null &&
				existing.id === instanceId &&
				roundTrip !== null &&
				status !== null &&
				mapWorkflowStatus(status.status) !== EXPORT_STATES.errored;
			if (!isLiveExisting) throw new ExportUnavailableError();
		}
		return { status: 'started', instanceId };
	}
);
