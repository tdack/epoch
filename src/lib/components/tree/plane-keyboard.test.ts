import { describe, expect, it } from 'vitest';
import { childLinks, planeNeighbour, type PlaneNav } from './plane-keyboard';

/**
 * Plane 0 holds the union (m, f) and its child c; plane 1 holds m's parents (gm, gf) and m's
 * sibling s, who stands beside them; plane 2 holds a cousin k.
 */
const nav: PlaneNav = {
	people: [
		{ id: 'm', group: 0, generation: 0, x: 0 },
		{ id: 'f', group: 0, generation: 0, x: 300 },
		{ id: 'c', group: 0, generation: 1, x: 150 },
		{ id: 'gm', group: 1, generation: -1, x: -100 },
		{ id: 'gf', group: 1, generation: -1, x: 200 },
		{ id: 's', group: 1, generation: 0, x: -250 },
		{ id: 'k', group: 2, generation: 1, x: -250 }
	],
	links: [
		{ childId: 'c', parentIds: ['m', 'f'], isSecondaryPath: false },
		{ childId: 'm', parentIds: ['gm', 'gf'], isSecondaryPath: false },
		{ childId: 's', parentIds: ['gm', 'gf'], isSecondaryPath: false },
		{ childId: 'k', parentIds: ['s'], isSecondaryPath: false }
	],
	unionPartners: [
		['m', 'f'],
		['gm', 'gf']
	]
};

describe('planeNeighbour', () => {
	it('goes up to the nearest parent, across planes, and down to the leftmost child', () => {
		// Equidistant parents: the lower id, as in the flat view.
		expect(planeNeighbour(nav, 'c', 'up')).toBe('f');
		expect(planeNeighbour(nav, 'm', 'up')).toBe('gm');
		expect(planeNeighbour(nav, 'gm', 'down')).toBe('s');
		expect(planeNeighbour(nav, 'm', 'down')).toBe('c');
		expect(planeNeighbour(nav, 'gm', 'up')).toBeNull();
		expect(planeNeighbour(nav, 'k', 'down')).toBeNull();
	});

	it('goes left and right within the row of one plane only', () => {
		expect(planeNeighbour(nav, 'm', 'right')).toBe('f');
		expect(planeNeighbour(nav, 'f', 'left')).toBe('m');
		// s is on another plane at the same generation, so it is not m's left neighbour.
		expect(planeNeighbour(nav, 'm', 'left')).toBeNull();
		expect(planeNeighbour(nav, 'f', 'right')).toBeNull();
	});

	it('steps back to the next plane that holds anyone, on the nearest generation', () => {
		expect(planeNeighbour(nav, 'm', 'back')).toBe('s');
		expect(planeNeighbour(nav, 'c', 'back')).toBe('s');
		expect(planeNeighbour(nav, 's', 'back')).toBe('k');
		expect(planeNeighbour(nav, 'k', 'back')).toBeNull();
	});

	it('steps back to the front, and skips an empty band', () => {
		expect(planeNeighbour(nav, 'k', 'front')).toBe('s');
		expect(planeNeighbour(nav, 's', 'front')).toBe('m');
		expect(planeNeighbour(nav, 'm', 'front')).toBeNull();
		const gap: PlaneNav = { ...nav, people: nav.people.filter((p) => p.group !== 1) };
		expect(planeNeighbour(gap, 'm', 'back')).toBe('k');
	});

	it('ignores an unknown person', () => {
		expect(planeNeighbour(nav, 'nobody', 'up')).toBeNull();
	});
});

describe('childLinks', () => {
	it('takes a union’s partners, else the parents the assertions name', () => {
		const partners = new Map([['u', ['a', 'b']]]);
		expect(
			childLinks(
				[
					{ childId: 'c', unionId: 'u', assertions: [], isSecondaryPath: false },
					{ childId: 'd', unionId: null, assertions: [{ parentId: 'a' }], isSecondaryPath: true }
				],
				partners
			)
		).toEqual([
			{ childId: 'c', parentIds: ['a', 'b'], isSecondaryPath: false },
			{ childId: 'd', parentIds: ['a'], isSecondaryPath: true }
		]);
	});
});
