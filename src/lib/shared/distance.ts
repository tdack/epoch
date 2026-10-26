/**
 * Great-circle distance between two points on the Earth's surface, in kilometres. Pure, so the
 * quality checks and any map code can share it.
 */

/** Mean radius of the Earth (IUGG). A sphere is within about 0.5% of the true figure, which a distance threshold does not need. */
const EARTH_RADIUS_KM = 6371.0088;

export interface LatLng {
	latitude: number;
	longitude: number;
}

/**
 * The haversine formula: stable for the short distances this is used for, where the spherical law
 * of cosines loses precision to rounding.
 */
export function distanceKm(from: LatLng, to: LatLng): number {
	const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
	const deltaLatitude = toRadians(to.latitude - from.latitude);
	const deltaLongitude = toRadians(to.longitude - from.longitude);
	const h =
		Math.sin(deltaLatitude / 2) ** 2 +
		Math.cos(toRadians(from.latitude)) *
			Math.cos(toRadians(to.latitude)) *
			Math.sin(deltaLongitude / 2) ** 2;
	return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}
