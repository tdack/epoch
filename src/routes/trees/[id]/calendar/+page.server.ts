import { treeServerLoad } from '#lib/server/http/page-load.js';
import { OverviewService } from '#lib/server/services/overview-service.js';
import { parseMonth } from '#lib/shared/calendar.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = treeServerLoad(
	{ failure: 'Failed to load the calendar', allowPublicVisitor: true },
	async ({ db, ctx, treeId }, { url }) => {
		// The server's UTC month: the nearest the server can come to the reader's own.
		const month = parseMonth(url.searchParams.get('month')) ?? new Date().getUTCMonth() + 1;
		return { month, entries: await new OverviewService(db).calendar(treeId, ctx, month) };
	}
);
