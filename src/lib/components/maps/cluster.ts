/**
 * Grid clustering for the place map. Leaflet.markercluster was not used: it targets Leaflet 1.x's
 * global `L` and an unmaintained mixin API, and this is about forty lines with no dependency. The
 * cells are screen pixels at the current zoom, so clusters split as the viewer zooms in.
 */

export interface ClusterInput {
	latitude: number;
	longitude: number;
}

export interface Cluster<T extends ClusterInput> {
	/** The mean of the members, so a cluster sits among its places. */
	latitude: number;
	longitude: number;
	members: T[];
}

const TILE_SIZE_PX = 256;
const MAX_MERCATOR_LATITUDE = 85.0511287798;

/** Web Mercator pixel position at a zoom; what Leaflet's default CRS projects to. */
export function mercatorPixels(
	latitude: number,
	longitude: number,
	zoom: number
): { x: number; y: number } {
	const scale = TILE_SIZE_PX * 2 ** zoom;
	const clamped = Math.max(-MAX_MERCATOR_LATITUDE, Math.min(MAX_MERCATOR_LATITUDE, latitude));
	const sin = Math.sin((clamped * Math.PI) / 180);
	return {
		x: ((longitude + 180) / 360) * scale,
		y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * scale
	};
}

/** Group points whose pixel positions share a `cellPx` square. Order of first appearance is kept. */
export function clusterPoints<T extends ClusterInput>(
	points: readonly T[],
	zoom: number,
	cellPx = 60,
	project: typeof mercatorPixels = mercatorPixels
): Array<Cluster<T>> {
	const cells = new Map<string, T[]>();
	for (const point of points) {
		const { x, y } = project(point.latitude, point.longitude, zoom);
		const key = `${Math.floor(x / cellPx)}:${Math.floor(y / cellPx)}`;
		const members = cells.get(key);
		if (members) members.push(point);
		else cells.set(key, [point]);
	}
	return [...cells.values()].map((members) => ({
		latitude: members.reduce((sum, m) => sum + m.latitude, 0) / members.length,
		longitude: members.reduce((sum, m) => sum + m.longitude, 0) / members.length,
		members
	}));
}
