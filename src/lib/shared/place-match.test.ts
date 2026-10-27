import { describe, expect, it } from 'vitest';
import type { GeoCandidate } from './geo';
import {
	HIGH_MATCH_SCORE,
	centroidOf,
	foldMatchText,
	matchScoreLabel,
	rankCandidates,
	scoreCandidate
} from './place-match';

const ballarat: GeoCandidate = {
	name: 'Ballarat',
	displayName: 'Ballarat, Victoria, Australia',
	latitude: -37.56,
	longitude: 143.85,
	osmType: 'R',
	osmId: 1,
	kind: 'city',
	country: 'Australia',
	state: 'Victoria',
	county: null,
	city: null
};
const farm: GeoCandidate = {
	...ballarat,
	name: 'Ballarat Farm',
	kind: 'farm',
	city: 'Smythesdale'
};
const melbourne = { latitude: -37.81, longitude: 144.96 };
const london = { latitude: 51.5, longitude: -0.12 };

const score = (text: string, candidate = ballarat, rank = 0, anchors = [melbourne]) =>
	scoreCandidate({ text, candidate, rank, anchors });

describe('foldMatchText', () => {
	it('ignores case, accents and punctuation', () => {
		expect(foldMatchText('  Zürich, ')).toBe('zurich');
		expect(foldMatchText("St. John's")).toBe('st john s');
	});
});

describe('scoreCandidate', () => {
	it('stays within 0 and 1', () => {
		expect(score('Ballarat, Victoria, Australia')).toBeLessThanOrEqual(1);
		expect(score('zzz', { ...ballarat, kind: null }, 99, [london])).toBeGreaterThanOrEqual(0);
	});

	it('scores a full match of every part, nearby, as High', () => {
		expect(score('Ballarat, Victoria, Australia')).toBeGreaterThanOrEqual(HIGH_MATCH_SCORE);
	});

	it('scores more matching parts higher', () => {
		expect(score('Ballarat, Victoria, Australia')).toBeGreaterThan(score('Ballarat, Tasmania'));
		expect(score('Ballarat, Tasmania')).toBeGreaterThan(score('Geelong, Tasmania'));
	});

	it('weighs the first part (the place itself) above the rest', () => {
		expect(score('Ballarat, Nowhere')).toBeGreaterThan(score('Nowhere, Victoria'));
	});

	it('matches without case or accents', () => {
		expect(score('BALLARAT, victoria')).toBe(score('ballarat, Victoria'));
		const zurich = { ...ballarat, name: 'Zürich', state: null, country: 'Switzerland' };
		expect(score('Zurich, Switzerland', zurich)).toBe(score('Zürich, Switzerland', zurich));
	});

	it('reads an abbreviation as the full name', () => {
		expect(score('Ballarat, Vic')).toBe(score('Ballarat, Victoria'));
		expect(score('Ballarat, Vic, Aus')).toBe(score('Ballarat, Victoria, Australia'));
	});

	it('does not read the wrong abbreviation as a match', () => {
		expect(score('Ballarat, Qld')).toBeLessThan(score('Ballarat, Vic'));
	});

	it('ranks an earlier Photon answer higher, down to a floor', () => {
		expect(score('Ballarat', ballarat, 0)).toBeGreaterThan(score('Ballarat', ballarat, 1));
		expect(score('Ballarat', ballarat, 3)).toBeGreaterThan(score('Ballarat', ballarat, 4));
		expect(score('Ballarat', ballarat, 4)).toBe(score('Ballarat', ballarat, 10));
	});

	it('prefers a candidate near a confirmed place, up to a cap', () => {
		const near = score('Ballarat', ballarat, 0, [{ latitude: -37.5, longitude: 143.9 }]);
		expect(near).toBeGreaterThan(score('Ballarat', ballarat, 0, [melbourne]));
		expect(score('Ballarat', ballarat, 0, [melbourne])).toBeGreaterThan(
			score('Ballarat', ballarat, 0, [london])
		);
		// Within the near radius every distance is the same.
		expect(score('Ballarat', ballarat, 0, [{ latitude: -37.56, longitude: 143.9 }])).toBe(near);
	});

	it('takes the nearest of several confirmed places', () => {
		expect(score('Ballarat', ballarat, 0, [london, melbourne])).toBe(
			score('Ballarat', ballarat, 0, [melbourne])
		);
	});

	it('is neutral, not a penalty, when the tree has no confirmed place', () => {
		const none = score('Ballarat', ballarat, 0, []);
		expect(none).toBeLessThan(score('Ballarat', ballarat, 0, [melbourne]));
		expect(none).toBeGreaterThan(score('Ballarat', ballarat, 0, [london]));
	});

	it('orders settlement above administrative above a farm', () => {
		const as = (kind: string | null) => score('Ballarat', { ...ballarat, kind });
		expect(as('town')).toBeGreaterThan(as('county'));
		expect(as('county')).toBeGreaterThan(as('farm'));
		expect(as('village')).toBe(as('city'));
		expect(as(null)).toBe(as('farm'));
	});

	it('scores a farm that shares the name below the town', () => {
		expect(score('Ballarat', farm)).toBeLessThan(score('Ballarat', ballarat));
	});

	it('gives text with no usable part no text credit', () => {
		expect(score(' , ')).toBeLessThan(score('Ballarat'));
	});
});

describe('matchScoreLabel', () => {
	it('draws the lines at 0.75 and 0.5', () => {
		expect(matchScoreLabel(0.75)).toBe('High');
		expect(matchScoreLabel(0.74)).toBe('Medium');
		expect(matchScoreLabel(0.5)).toBe('Medium');
		expect(matchScoreLabel(0.49)).toBe('Low');
	});
});

describe('rankCandidates', () => {
	it('sorts best first, keeps at most five, and carries the score', () => {
		const many = Array.from({ length: 8 }, (_, i) => ({ ...farm, displayName: `Farm ${i}` }));
		const ranked = rankCandidates('Ballarat, Victoria', [...many, ballarat], [melbourne]);
		expect(ranked).toHaveLength(5);
		expect(ranked[0]!.displayName).toBe('Ballarat, Victoria, Australia');
		const scores = ranked.map((c) => c.score);
		expect(scores).toEqual([...scores].sort((a, b) => b - a));
	});
});

describe('centroidOf', () => {
	it('is null for no points and the mean otherwise', () => {
		expect(centroidOf([])).toBeNull();
		const points = [
			{ latitude: 10, longitude: 20 },
			{ latitude: 20, longitude: 40 }
		];
		expect(centroidOf(points)).toEqual({ latitude: 15, longitude: 30 });
	});
});
