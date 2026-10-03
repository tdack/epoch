import { treeHandler } from '#lib/server/http/handler.js';
import { MarkService } from '#lib/server/services/mark-service.js';

/**
 * Record that the user opened a person. A POST from the page, never a side effect of a GET or a
 * load: SvelteKit preloads links on hover, and a preload must not log people nobody opened.
 * Idempotent: a repeat moves the person to the front. Answers with the marks, so the page updates in place.
 */
export const POST = treeHandler(
	{ failure: 'Failed to record the recent person' },
	async ({ db, ctx, treeId, event }) => {
		const body = (await event.request.json().catch(() => null)) as { personId?: unknown } | null;
		if (typeof body?.personId !== 'string' || !body.personId)
			return Response.json({ error: 'personId required' }, { status: 400 });
		const service = new MarkService(db);
		await service.recordRecent(treeId, body.personId, ctx);
		return service.get(treeId, ctx);
	}
);
