/**
 * Rules for what may be sent to a geocoder (ADR-078). Pure, so the browser can skip a call the
 * server would refuse anyway.
 */

/** Shorter text matches too much to be worth a call. */
const MIN_GEOCODE_QUERY_LENGTH = 3;

/** Lower-cased with runs of whitespace collapsed: the form that is cached and searched. */
export function normaliseGeoQuery(text: string): string {
	return text.trim().replace(/\s+/g, ' ').toLowerCase();
}

// A house number, with an optional unit word before it: "12 ", "12a ", "4/12", "Flat 3", "Unit 4/".
const STREET_ADDRESS =
	/^(?:(?:flat|unit|apt|apartment|suite|lot|shop|level)\s*)?\d+[a-z]?(?:[\s/,-]|$)/;

/**
 * Whether the text starts like a street address. These name a household, so they are never sent
 * to a third party (ADR-078). shortcut: a leading number only, so "Cottage 3, Ballarat" passes;
 * tighten if real addresses get through.
 */
export function looksLikeStreetAddress(text: string): boolean {
	return STREET_ADDRESS.test(normaliseGeoQuery(text));
}

/** Whether this text may be sent to the geocoder at all. */
export function isGeocodable(text: string): boolean {
	const query = normaliseGeoQuery(text);
	return query.length >= MIN_GEOCODE_QUERY_LENGTH && !looksLikeStreetAddress(query);
}

/** One place the geocoder offered. */
export interface GeoCandidate {
	name: string;
	displayName: string;
	latitude: number;
	longitude: number;
	osmType: 'N' | 'W' | 'R' | null;
	osmId: number | null;
	kind: string | null;
	country: string | null;
	state: string | null;
	county: string | null;
	city: string | null;
}

export interface GeoSearchResponse {
	results: GeoCandidate[];
}

/** The map settings with their defaults applied (ADR-078). */
export interface MapsSettings {
	isGeocodingEnabled: boolean;
	photonUrl: string;
	tileUrl: string;
	tileAttribution: string;
}

export const DEFAULT_MAPS_SETTINGS: Readonly<MapsSettings> = {
	isGeocodingEnabled: true,
	photonUrl: 'https://photon.komoot.io',
	tileUrl: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
	tileAttribution:
		'© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
};

/** The stored group may hold any subset; a missing group or field takes the default. */
export function resolveMapsSettings(stored: Partial<MapsSettings> | undefined): MapsSettings {
	return { ...DEFAULT_MAPS_SETTINGS, ...stored };
}

/** One place on a map; `href` is where its popup links. */
export interface MapMarker {
	id: string;
	label: string;
	href: string;
	latitude: number;
	longitude: number;
	/** Facts at the place, shown in the popup. */
	count: number;
}

/** A map viewport in degrees. */
export interface MapBounds {
	south: number;
	west: number;
	north: number;
	east: number;
}

/**
 * Whether a point lies inside the viewport. shortcut: no antimeridian handling, so a viewport that
 * straddles 180 degrees lists too few places; upgrade if a tree spans the Pacific.
 */
export function isInBounds(latitude: number, longitude: number, bounds: MapBounds): boolean {
	return (
		latitude >= bounds.south &&
		latitude <= bounds.north &&
		longitude >= bounds.west &&
		longitude <= bounds.east
	);
}
