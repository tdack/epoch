import { expectedVersion, treeHandler } from '#lib/server/http/handler.js';
import { PlaceService } from '#lib/server/services/place-service.js';
import { placeLocationSchema } from '#lib/server/validation/schemas.js';

/** Set a place's location, or leave it off maps. An editor or above; logged, so it can be undone. */
export const PUT = treeHandler(
	{ failure: 'Failed to save the location', params: ['placeId'], body: placeLocationSchema },
	async ({ db, ctx, treeId, params, body }) => {
		const placeId = params.placeId;
		const change =
			body.status === 'ignored'
				? { kind: 'ignore_place_location' as const, placeId, expectedVersion: body.version }
				: {
						kind: 'set_place_location' as const,
						placeId,
						expectedVersion: body.version,
						latitude: body.latitude,
						longitude: body.longitude,
						source: body.source,
						osmType: body.osmType,
						osmId: body.osmId,
						displayName: body.displayName
					};
		const { change: logged } = await new PlaceService(db).changeLocation(treeId, change, ctx);
		return { change: logged };
	}
);

/** Clear a place's location. An editor or above; logged, so it can be undone. */
export const DELETE = treeHandler(
	{ failure: 'Failed to clear the location', params: ['placeId'] },
	async ({ db, ctx, treeId, params, url }) => {
		const { change } = await new PlaceService(db).changeLocation(
			treeId,
			{
				kind: 'clear_place_location',
				placeId: params.placeId,
				expectedVersion: expectedVersion(url)
			},
			ctx
		);
		return { change };
	}
);
