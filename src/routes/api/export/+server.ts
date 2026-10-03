import { apiHandler } from '#lib/server/http/handler.js';
import { GedcomService } from '#lib/server/services/gedcom-service.js';
import type { GedcomFormat } from '#lib/server/gedcom/tags.js';
import { exportBodySchema } from '#lib/server/validation/schemas.js';

const options = { failure: 'Export failed', messagePrefix: 'Export failed: ' };

function resolveFormat(raw: string | null): GedcomFormat {
	return raw === 'gedcom7' ? 'gedcom7' : 'gedcom551';
}

export const GET = apiHandler(options, async ({ db, ctx, url }) => {
	const treeId = url.searchParams.get('treeId');
	if (!treeId) {
		return Response.json({ error: 'treeId query parameter required' }, { status: 400 });
	}
	const { content, filename } = await new GedcomService(db).exportDownload(
		treeId,
		resolveFormat(url.searchParams.get('format')),
		ctx
	);
	return new Response(content, {
		status: 200,
		headers: {
			'Content-Type': 'text/vnd.familysearch.gedcom; charset=utf-8',
			'Content-Disposition': `attachment; filename="${filename}"`
		}
	});
});

export const POST = apiHandler(
	{ ...options, body: exportBodySchema },
	async ({ db, ctx, event, body }) => {
		const { treeId } = body;
		const format = resolveFormat(body.format ?? null);
		const env = event.platform?.env;
		const service = new GedcomService(db, { bucket: env?.MEDIA_BUCKET });
		await service.requireExport(treeId, ctx);

		// Trigger Cloudflare Workflow if binding exists
		if (env?.GEDCOM_EXPORT_WORKFLOW) {
			const instance = await env.GEDCOM_EXPORT_WORKFLOW.create({
				params: { treeId, format, userId: ctx.user.id }
			});
			return { status: 'started', instanceId: instance.id };
		}

		// Fallback direct execution
		if (!env?.MEDIA_BUCKET) {
			return Response.json({ error: 'Storage binding unavailable' }, { status: 500 });
		}
		return { status: 'complete', fileKey: await service.exportToStorage(treeId, format, ctx) };
	}
);
