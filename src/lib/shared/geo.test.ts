import { describe, expect, it } from 'vitest';
import {
	DEFAULT_MAPS_SETTINGS,
	isGeocodable,
	looksLikeStreetAddress,
	normaliseGeoQuery,
	resolveMapsSettings
} from './geo.js';

describe('normaliseGeoQuery', () => {
	it('trims, collapses whitespace and lower-cases', () => {
		expect(normaliseGeoQuery("  St  Mary's,\tBallarat \n")).toBe("st mary's, ballarat");
	});
});

describe('looksLikeStreetAddress', () => {
	it.each([
		'12 High Street',
		'12a High Street',
		'Flat 3, Rose Court',
		'Unit 4/12 Main Rd',
		'4/12 Main'
	])('catches %s', (text) => expect(looksLikeStreetAddress(text)).toBe(true));
	it.each(['Ballarat', 'St Mary Church, Kent', 'Newcastle upon Tyne', 'Les Trois Moutiers'])(
		'lets %s through',
		(text) => expect(looksLikeStreetAddress(text)).toBe(false)
	);
});

describe('isGeocodable', () => {
	it('refuses short text and addresses', () => {
		expect(isGeocodable('ab')).toBe(false);
		expect(isGeocodable('  ab  ')).toBe(false);
		expect(isGeocodable('12 High Street')).toBe(false);
		expect(isGeocodable('Ballarat')).toBe(true);
	});
});

describe('resolveMapsSettings', () => {
	it('returns the defaults for a missing group and overlays a stored subset', () => {
		expect(resolveMapsSettings(undefined)).toEqual(DEFAULT_MAPS_SETTINGS);
		expect(resolveMapsSettings({ isGeocodingEnabled: false })).toEqual({
			...DEFAULT_MAPS_SETTINGS,
			isGeocodingEnabled: false
		});
	});
});
