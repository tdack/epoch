import { apiHandler } from '#lib/server/http/handler.js';
import { GedcomService } from '#lib/server/services/gedcom-service.js';
import { DEFAULT_GEDCOM_FORMAT, type GedcomFormat } from '#lib/server/gedcom/tags.js';
import { exportBodySchema } from '#lib/server/validation/schemas.js';

const options = { failure: 'Export failed', messagePrefix: 'Export failed: ' };

function resolveFormat(raw: string | null): GedcomFormat {
	return raw === 'gedcom551' || raw === 'gedcom7' ? raw : DEFAULT_GEDCOM_FORMAT;
}

export const GET = apiHandler(options, async ({ db, ctx, url }) => {
	const treeId = url.searchParams.get('treeId');
	if (!treeId) {
		return Response.json({ error: 'treeId query parameter required' }, { status: 400 });
	}
	const { content, filename, contentType } = await new GedcomService(db).exportDownload(
		treeId,
		{
			format: resolveFormat(url.searchParams.get('format')),
			shouldCompress: url.searchParams.get('package') === 'gdz'
		},
		ctx
	);
	return new Response(content, {
		status: 200,
		headers: {
			'Content-Type': typeof content === 'string' ? `${contentType}; charset=utf-8` : contentType,
			'Content-Disposition': `attachment; filename="${filename}"`
		}
	});
});

export const POST = apiHandler(
	{ ...options, body: exportBodySchema },
	async ({ db, ctx, event, body }) => {
		const { treeId } = body;
		const exportOptions = {
			format: resolveFormat(body.format ?? null),
			shouldCompress: body.shouldCompress ?? false
		};
		const env = event.platform?.env;
		const service = new GedcomService(db, { bucket: env?.MEDIA_BUCKET });
		await service.requireExport(treeId, ctx);

		// Trigger Cloudflare Workflow if binding exists
		if (env?.GEDCOM_EXPORT_WORKFLOW) {
			const instance = await env.GEDCOM_EXPORT_WORKFLOW.create({
				params: { treeId, ...exportOptions, userId: ctx.user.id }
			});
			return { status: 'started', instanceId: instance.id };
		}

		// Fallback direct execution
		if (!env?.MEDIA_BUCKET) {
			return Response.json({ error: 'Storage binding unavailable' }, { status: 500 });
		}
		return {
			status: 'complete',
			fileKey: await service.exportToStorage(treeId, exportOptions, ctx)
		};
	}
);
