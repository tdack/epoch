import { error } from '@sveltejs/kit';
import { treeServerLoad } from '#lib/server/http/page-load.js';
import { PlaceService } from '#lib/server/services/place-service.js';
import { SettingsService } from '#lib/server/services/settings-service.js';
import { parseListParams } from '#lib/shared/lists.js';
import type { PageServerLoad } from './$types';

/** The place is in the address as `?name=`, the text of the place as it is written on its facts. */
export const load: PageServerLoad = treeServerLoad(
	{ failure: 'Failed to load the place', allowPublicVisitor: true },
	async ({ db, ctx, treeId, subtree }, { url }) => {
		const name = url.searchParams.get('name');
		if (!name) error(404, 'Place not found');
		const { tileUrl, tileAttribution } = await new SettingsService(db).maps();
		return {
			place: await new PlaceService(db).detail(
				treeId,
				name,
				parseListParams(url.searchParams),
				ctx,
				subtree?.rootPersonId ?? null
			),
			tiles: { tileUrl, tileAttribution }
		};
	}
);
