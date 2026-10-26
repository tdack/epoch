import { treeServerLoad } from '#lib/server/http/page-load.js';
import { PlaceService } from '#lib/server/services/place-service.js';
import { SettingsService } from '#lib/server/services/settings-service.js';
import { parseListParams } from '#lib/shared/lists.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = treeServerLoad(
	{ failure: 'Failed to list places', allowPublicVisitor: true },
	async ({ db, ctx, treeId, subtree }, { url }) => {
		const q = url.searchParams.get('q') ?? '';
		const isUnlocated = url.searchParams.get('unlocated') === '1';
		const { tileUrl, tileAttribution } = await new SettingsService(db).maps();
		const places = new PlaceService(db);
		const lensRootId = subtree?.rootPersonId ?? null;
		return {
			q,
			isUnlocated,
			page: await places.list(
				treeId,
				{ q, isUnlocated, ...parseListParams(url.searchParams) },
				ctx,
				lensRootId
			),
			map: await places.mapData(treeId, ctx, lensRootId),
			tiles: { tileUrl, tileAttribution }
		};
	}
);
