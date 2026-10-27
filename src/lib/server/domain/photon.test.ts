import { describe, expect, it } from 'vitest';
import { candidatesFromPhoton } from './photon';

const BALLARAT = {
	type: 'Feature',
	geometry: { type: 'Point', coordinates: [143.85, -37.56] },
	properties: {
		osm_type: 'R',
		osm_id: 2431150,
		osm_value: 'city',
		name: 'Ballarat',
		state: 'Victoria',
		country: 'Australia',
		county: 'Ballarat'
	}
};

describe('candidatesFromPhoton', () => {
	it('maps a feature, flipping [lon, lat] and joining a display name without repeats', () => {
		expect(candidatesFromPhoton({ features: [BALLARAT] })).toEqual([
			{
				name: 'Ballarat',
				displayName: 'Ballarat, Victoria, Australia',
				latitude: -37.56,
				longitude: 143.85,
				osmType: 'R',
				osmId: 2431150,
				kind: 'city',
				country: 'Australia',
				state: 'Victoria',
				county: 'Ballarat',
				city: null
			}
		]);
	});

	it('keeps only the first of two features with the same display name', () => {
		const council = {
			...BALLARAT,
			properties: { ...BALLARAT.properties, osm_value: 'administrative' }
		};
		const found = candidatesFromPhoton({ features: [BALLARAT, council] });
		expect(found.map((c) => c.kind)).toEqual(['city']);
	});

	it('skips features without a name or usable point, and caps the list at eight', () => {
		const bad = [
			{ geometry: { coordinates: [1, 2] }, properties: {} },
			{ geometry: { coordinates: [1] }, properties: { name: 'x' } },
			{ geometry: { coordinates: [1, 99] }, properties: { name: 'Off the map' } }
		];
		expect(candidatesFromPhoton({ features: bad })).toEqual([]);
		const many = Array.from({ length: 12 }, (_, i) => ({
			...BALLARAT,
			properties: { ...BALLARAT.properties, name: `Ballarat ${i}` }
		}));
		expect(candidatesFromPhoton({ features: many })).toHaveLength(8);
		expect(candidatesFromPhoton('nonsense')).toEqual([]);
	});
});
