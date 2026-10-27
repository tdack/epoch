import { treeHandler } from '#lib/server/http/handler.js';
import { OverviewService } from '#lib/server/services/overview-service.js';
import { anniversaryWhat } from '#lib/shared/calendar.js';
import { toIcs } from '#lib/shared/ics.js';

// A download, not a subscription feed: a calendar app polling a URL cannot sign in through
// Cloudflare Access, and an unauthenticated feed would be a back door around the privacy masking.
export const GET = treeHandler(
	{ allowPublicVisitor: true, failure: 'Failed to build the calendar file' },
	async ({ db, ctx, treeId }) => {
		const entries = await new OverviewService(db).calendar(treeId, ctx);
		const stamp = new Date().toISOString().replace(/[-:]|\.\d{3}/g, '');
		const body = toIcs(
			entries.map((a) => {
				const [month, day] = a.monthDay.split('-').map(Number) as [number, number];
				return {
					uid: `${a.id}@epoch`,
					summary: anniversaryWhat(a),
					year: a.year,
					month,
					day
				};
			}),
			stamp
		);
		return new Response(body, {
			headers: {
				'Content-Type': 'text/calendar; charset=utf-8',
				'Content-Disposition': 'attachment; filename="anniversaries.ics"'
			}
		});
	}
);
