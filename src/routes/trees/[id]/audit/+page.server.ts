import { treeServerLoad } from '#lib/server/http/page-load.js';
import { ChangeLogService } from '#lib/server/services/change-log-service.js';
import type { PageServerLoad } from './$types';

/** The cursor and the record filter live in the address, so a refresh and a shared link keep them. */
export const load: PageServerLoad = treeServerLoad(
	{ failure: 'Failed to load the audit log' },
	async ({ db, ctx, treeId }, { url }) => {
		const before = Number(url.searchParams.get('before'));
		const recordId = url.searchParams.get('record') || null;
		return {
			recordId,
			audit: await new ChangeLogService(db).audit(treeId, ctx, {
				before: Number.isInteger(before) && before > 0 ? before : null,
				recordId
			})
		};
	}
);
