import { treeServerLoad } from '#lib/server/http/page-load.js';
import { PlaceMatchService } from '#lib/server/services/place-match-service.js';
import { SettingsService } from '#lib/server/services/settings-service.js';
import { parseListParams } from '#lib/shared/lists.js';
import type { PageServerLoad } from './$types';

/** A manager's screen: the service refuses anyone else, and the error page says so. */
export const load: PageServerLoad = treeServerLoad(
	{ failure: 'Failed to load the place matches' },
	async ({ db, ctx, treeId }, { url }) => {
		const review = await new PlaceMatchService(db).review(
			treeId,
			parseListParams(url.searchParams),
			ctx
		);
		const { tileUrl, tileAttribution } = await new SettingsService(db).maps();
		return { review, tiles: { tileUrl, tileAttribution } };
	}
);
