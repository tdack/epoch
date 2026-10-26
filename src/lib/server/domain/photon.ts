/** Maps Photon's GeoJSON answer to Epoch's candidates (ADR-078). No I/O. */

import type { GeoCandidate } from '../../shared/geo';

export const MAX_GEO_CANDIDATES = 8;

/**
 * Photon's layers for towns and wider. Houses and streets are left out: Epoch places are
 * settlements and regions, and an address is never what the owner wants suggested.
 */
export const PHOTON_PLACE_LAYERS = ['city', 'locality', 'district', 'county', 'state', 'country'];

const OSM_TYPES = new Set(['N', 'W', 'R']);

function text(value: unknown): string | null {
	return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

/** Photon's `features`, mapped; anything malformed is skipped rather than failing the list. */
export function candidatesFromPhoton(json: unknown): GeoCandidate[] {
	const features = (json as { features?: unknown } | null)?.features;
	if (!Array.isArray(features)) return [];
	const found: GeoCandidate[] = [];
	for (const feature of features) {
		const coordinates = feature?.geometry?.coordinates;
		const props = feature?.properties ?? {};
		const [longitude, latitude] = Array.isArray(coordinates) ? coordinates : [];
		const name = text(props.name);
		if (!name || !Number.isFinite(latitude) || !Number.isFinite(longitude)) continue;
		if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) continue;
		const country = text(props.country);
		const state = text(props.state);
		const county = text(props.county);
		const city = text(props.city);
		const displayName = [...new Set([name, city, county, state, country].filter(Boolean))].join(
			', '
		);
		found.push({
			name,
			displayName,
			latitude,
			longitude,
			osmType: OSM_TYPES.has(props.osm_type) ? props.osm_type : null,
			osmId: Number.isInteger(props.osm_id) ? props.osm_id : null,
			kind: text(props.osm_value) ?? text(props.type),
			country,
			state,
			county,
			city
		});
		if (found.length === MAX_GEO_CANDIDATES) break;
	}
	return found;
}
