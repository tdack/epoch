import { treeHandler } from '#lib/server/http/handler.js';
import { DateService } from '#lib/server/services/date-service.js';

/** The dates that would take their standard spelling, before and after. Saves nothing. */
export const GET = treeHandler(
	{ failure: 'Failed to preview standardising the dates' },
	({ db, ctx, treeId }) => new DateService(db).previewStandardise(treeId, ctx)
);

/** Give every such date its standard spelling: one change, one undo. */
export const POST = treeHandler(
	{ failure: 'Failed to standardise the dates' },
	async ({ db, ctx, treeId }) => {
		const { change, remaining } = await new DateService(db).standardise(treeId, ctx);
		return { change, remaining };
	}
);
