import { treeServerLoad } from '#lib/server/http/page-load.js';
import { ChangeLogService } from '#lib/server/services/change-log-service.js';
import type { AuditFilters } from '#lib/shared/change-audit.js';
import type { PageServerLoad } from './$types';

/** A calendar day as `YYYY-MM-DD`, or null for anything else, so a bad address is an unfiltered one. */
function dayOf(value: string | null): string | null {
	return value && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value))
		? value
		: null;
}

/** The filters and page live in the address, so a refresh and a shared link keep them. */
export const load: PageServerLoad = treeServerLoad(
	{ failure: 'Failed to load the audit log' },
	async ({ db, ctx, treeId }, { url }) => {
		const q = url.searchParams;
		const filters: AuditFilters = {
			recordId: q.get('record') || null,
			actorId: q.get('actor') || null,
			from: dayOf(q.get('from')),
			to: dayOf(q.get('to'))
		};
		const page = Number.parseInt(q.get('page') ?? '', 10);
		return {
			filters,
			audit: await new ChangeLogService(db).audit(treeId, ctx, {
				...filters,
				page: Number.isNaN(page) ? 1 : page
			})
		};
	}
);
