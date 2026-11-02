import { treeServerLoad } from '#lib/server/http/page-load.js';
import { OverviewService } from '#lib/server/services/overview-service.js';
import { dayInZone, TIME_ZONE_COOKIE, zoneFromCookie } from '#lib/shared/display-zone.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = treeServerLoad(
	{ failure: 'Failed to load the overview', allowPublicVisitor: true },
	async ({ db, ctx, treeId }, { cookies }) => {
		const overview = await new OverviewService(db).load(treeId, ctx);
		const timeZone = zoneFromCookie(cookies.get(TIME_ZONE_COOKIE));
		// The service's anniversary window runs from the day before the UTC day to a month and a day
		// after, which holds the reader's day and the next 30 whatever their zone (UTC-12 to UTC+14).
		const today = dayInZone(new Date(), timeZone);
		return { overview: { ...overview, today }, timeZone, now: new Date() };
	}
);
