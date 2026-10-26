import { treeHandler } from '#lib/server/http/handler.js';
import { GeoService } from '#lib/server/services/geo-service.js';
import type { GeoSearchResponse } from '#lib/shared/geo.js';

/** A coordinate from the query string, or undefined when absent or out of range. */
function coordinate(value: string | null, limit: number): number | undefined {
	if (value === null || value.trim() === '') return undefined;
	const number = Number(value);
	return Math.abs(number) <= limit ? number : undefined;
}

/**
 * Place suggestions for someone adding places to this tree. Under the tree, not `/api/geo`, so the
 * same deny-by-default membership check as every tree route decides who spends the shared
 * geocoder allowance (`record:create`, contributors and up).
 */
export const GET = treeHandler(
	{ failure: 'Failed to search places' },
	async ({ db, ctx, treeId, url }): Promise<GeoSearchResponse> => {
		const params = url.searchParams;
		const results = await new GeoService(db).searchInTree(
			treeId,
			params.get('q') ?? '',
			{
				lang: params.get('lang') ?? undefined,
				latitude: coordinate(params.get('lat'), 90),
				longitude: coordinate(params.get('lon'), 180)
			},
			ctx
		);
		return { results };
	}
);
