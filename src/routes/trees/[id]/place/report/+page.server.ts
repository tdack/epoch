import { error } from '@sveltejs/kit';
import { treeServerLoad } from '#lib/server/http/page-load.js';
import { PlaceService } from '#lib/server/services/place-service.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = treeServerLoad(
	{ failure: 'Failed to load the place report', allowPublicVisitor: true },
	async ({ db, ctx, treeId, subtree }, { url }) => {
		const name = url.searchParams.get('name');
		if (!name) error(404, 'Place not found');
		return {
			place: await new PlaceService(db).report(treeId, name, ctx, subtree?.rootPersonId ?? null)
		};
	}
);
