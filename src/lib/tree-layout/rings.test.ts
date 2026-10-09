import { describe, expect, it } from 'vitest';
import { buildIndex } from './graph-index';
import {
	circularMean,
	layoutRings,
	ringLineage,
	RING_MIN_RADIUS_UNITS,
	RING_SLOT_UNITS,
	separate,
	type Arc,
	type RingsLayout
} from './rings';
import { selectFocusSubgraph } from './select';
import { selectWholeTree } from './whole-tree';
import { allTestGraphs, makeGraph } from './test-support';
import type { FocusViewOptions } from './types';

const OPTIONS: FocusViewOptions[] = [
	{},
	{ ancestorDepth: 5, descendantDepth: 5, collateralDepth: 2, shouldIncludePartnerOrigins: true },
	{ ancestorDepth: 1, descendantDepth: 1, shouldIncludeStepFamilies: true }
];
const TAU = Math.PI * 2;

/** Angular distance between two angles, 0 to π. */
const apart = (a: number, b: number) => {
	const d = Math.abs(a - b) % TAU;
	return Math.min(d, TAU - d);
};

/** Pairs on one ring standing closer than a slot (or than an even share when the ring is full). */
function crowding(layout: RingsLayout): string[] {
	const found: string[] = [];
	for (const ring of layout.rings) {
		const onRing = layout.people.filter((p) => p.generation === ring.generation);
		const slot = Math.min(RING_SLOT_UNITS / ring.radius, TAU / ring.count);
		for (let i = 0; i < onRing.length; i++)
			for (let j = i + 1; j < onRing.length; j++)
				if (apart(onRing[i].angle, onRing[j].angle) < slot - 1e-4)
					found.push(`${onRing[i].id} crowds ${onRing[j].id} on ${ring.generation}`);
	}
	return found;
}

describe('layoutRings contract', () => {
	for (const { name, graph } of allTestGraphs()) {
		it(`${name}: every person as focus honours the rings contract`, () => {
			const index = buildIndex(graph);
			// The 551-person capture is slow under every focus; a stride still covers its shapes.
			const stride = graph.people.length > 100 ? 17 : 1;
			for (const options of OPTIONS) {
				for (const focus of graph.people.filter((_, i) => i % stride === 0)) {
					const layout = layoutRings(graph, focus.id, options, index);
					const label = `${name} focus ${focus.id} ${JSON.stringify(options)}`;
					const selection = selectFocusSubgraph(graph, focus.id, options, index)!;

					// Everyone the selection draws stands once, on the ring of their generation.
					const ids = layout.people.map((p) => p.id);
					expect(new Set(ids).size, label).toBe(ids.length);
					expect(new Set(ids), label).toEqual(new Set(selection.people.map((p) => p.id)));
					for (const p of selection.people)
						expect(layout.people.find((q) => q.id === p.id)!.generation, label).toBe(p.generation);

					for (const p of layout.people) {
						expect(p.angle, label).toBeGreaterThanOrEqual(0);
						expect(p.angle, label).toBeLessThan(TAU);
					}
					expect(crowding(layout), label).toEqual([]);

					// Rings run oldest first, one per generation, each wide enough for its people.
					const generations = layout.rings.map((r) => r.generation);
					expect(generations, label).toEqual([...generations].sort((a, b) => a - b));
					for (const ring of layout.rings) {
						expect(ring.count, label).toBe(
							layout.people.filter((p) => p.generation === ring.generation).length
						);
						expect(ring.radius, label).toBeGreaterThanOrEqual(RING_MIN_RADIUS_UNITS);
					}

					// Lines join drawn people, from a placed union holding one of the child's parents.
					const drawn = new Set(ids);
					const unionById = new Map(layout.unions.map((u) => [u.id, u]));
					for (const line of layout.childLinks) {
						expect(drawn.has(line.childId), label).toBe(true);
						for (const id of line.parentIds) expect(drawn.has(id), label).toBe(true);
						if (line.fromUnionId !== null) {
							const union = unionById.get(line.fromUnionId);
							expect(union, label).toBeDefined();
							expect(
								line.parentIds.every((id) => union!.partnerIds.includes(id)),
								label
							).toBe(true);
						} else expect(drawn.has(line.fromPersonId!), label).toBe(true);
					}
					expect(layoutRings(graph, focus.id, options, index), label).toEqual(layout);
				}
			}
		});
	}
});

describe('layoutRings placement', () => {
	const graph = makeGraph({
		people: ['gp1', 'gp2', 'a', 'b', 'spouse-a', 'spouse-b', 'a1', 'a2', 'b1'],
		unions: [
			{ id: 'u-gp', partners: ['gp1', 'gp2'], children: ['a', 'b'] },
			{ id: 'u-a', partners: ['a', 'spouse-a'], children: ['a1', 'a2'] },
			{ id: 'u-b', partners: ['b', 'spouse-b'], children: ['b1'] }
		]
	});
	const layout = layoutRings(graph, 'a', { collateralDepth: 2 });
	const at = (id: string) => layout.people.find((p) => p.id === id)!;

	it('stacks one ring per generation, oldest first', () => {
		expect(layout.rings.map((r) => [r.generation, r.count])).toEqual([
			[-1, 2],
			[0, 4],
			[1, 3]
		]);
	});

	it('stands partners next to each other', () => {
		const ring0 = layout.rings.find((r) => r.generation === 0)!;
		const slot = Math.min(RING_SLOT_UNITS / ring0.radius, TAU / ring0.count);
		expect(apart(at('a').angle, at('spouse-a').angle)).toBeCloseTo(slot, 5);
		expect(apart(at('b').angle, at('spouse-b').angle)).toBeCloseTo(slot, 5);
	});

	it('puts children nearer their own parents than their cousins’ parents', () => {
		const uA = layout.unions.find((u) => u.id === 'u-a')!;
		const uB = layout.unions.find((u) => u.id === 'u-b')!;
		expect(apart(at('a1').angle, uA.angle)).toBeLessThan(apart(at('a1').angle, uB.angle));
		expect(apart(at('b1').angle, uB.angle)).toBeLessThan(apart(at('b1').angle, uA.angle));
	});

	it('draws one line per child from the partnership', () => {
		expect(
			layout.childLinks
				.filter((l) => l.fromUnionId === 'u-a')
				.map((l) => [l.childId, l.parentIds.sort()])
		).toEqual([
			['a1', ['a', 'spouse-a']],
			['a2', ['a', 'spouse-a']]
		]);
	});

	it('finds the focus line', () => {
		const line = ringLineage(layout, 'a');
		expect([...line.ancestorIds].sort()).toEqual(['gp1', 'gp2']);
		expect([...line.descendantIds].sort()).toEqual(['a1', 'a2']);
		expect([...line.partnerIds]).toEqual(['spouse-a']);
	});
});

describe('layoutRings edge cases', () => {
	it('draws a repeated ancestor once, with both lines reaching them', () => {
		const graph = makeGraph({
			people: ['g1', 'g2', 'a', 'b', 'sa', 'sb', 'k1', 'k2', 'c'],
			unions: [
				{ id: 'u-g', partners: ['g1', 'g2'], children: ['a', 'b'] },
				{ id: 'u-a', partners: ['a', 'sa'], children: ['k1'] },
				{ id: 'u-b', partners: ['b', 'sb'], children: ['k2'] },
				{ id: 'u-k', partners: ['k1', 'k2'], children: ['c'] }
			]
		});
		const layout = layoutRings(graph, 'c', { ancestorDepth: 3 });
		expect(layout.people.filter((p) => p.id === 'g1')).toHaveLength(1);
		expect(layout.childLinks.filter((l) => l.fromUnionId === 'u-g').map((l) => l.childId)).toEqual([
			'a',
			'b'
		]);
		expect([...ringLineage(layout, 'c').ancestorIds].sort()).toEqual(
			['a', 'b', 'g1', 'g2', 'k1', 'k2', 'sa', 'sb'].sort()
		);
	});

	it('runs a direct parent link from the parent, not a partnership', () => {
		const graph = makeGraph({
			people: ['p', 'c'],
			direct: [{ parentId: 'p', childId: 'c', type: 'adoptive' }]
		});
		const layout = layoutRings(graph, 'c');
		expect(layout.childLinks).toEqual([
			{ childId: 'c', fromUnionId: null, fromPersonId: 'p', type: 'adoptive', parentIds: ['p'] }
		]);
	});

	it('chains a person with two partners between them', () => {
		const graph = makeGraph({
			people: ['ex', 'me', 'now'],
			unions: [
				{ id: 'u-ex', partners: ['me', 'ex'], marriageDate: '1990' },
				{ id: 'u-now', partners: ['me', 'now'], marriageDate: '2000' }
			]
		});
		const layout = layoutRings(graph, 'me');
		const angle = (id: string) => layout.people.find((p) => p.id === id)!.angle;
		expect(apart(angle('ex'), angle('now'))).toBeGreaterThan(apart(angle('me'), angle('ex')));
		expect(apart(angle('ex'), angle('now'))).toBeGreaterThan(apart(angle('me'), angle('now')));
	});

	it('is empty for no focus or a missing one', () => {
		const graph = makeGraph({ people: ['a'] });
		expect(layoutRings(graph, null).people).toEqual([]);
		expect(layoutRings(graph, 'nobody').people).toEqual([]);
	});
});

describe('circularMean', () => {
	it('averages across the 0/2π seam', () => {
		expect(circularMean([TAU - 0.1, 0.1])).toBeCloseTo(0, 6);
		expect(circularMean([1, 2])).toBeCloseTo(1.5, 6);
	});

	it('is null when the angles cancel out', () => {
		expect(circularMean([0, Math.PI])).toBeNull();
		expect(circularMean([])).toBeNull();
	});
});

describe('separate', () => {
	const arc = (want: number, members: number): Arc => ({
		members: Array.from({ length: members }, (_, i) => `${want}:${i}`),
		want,
		at: want,
		span: members * 0.1
	});
	const gaps = (arcs: Arc[]) =>
		arcs.map((a, i) => {
			const b = arcs[(i + 1) % arcs.length];
			return b.at - a.at + (i === arcs.length - 1 ? TAU : 0) - (a.span + b.span) / 2;
		});

	it('leaves arcs that already fit exactly where they want to be', () => {
		const arcs = [arc(1, 2), arc(3, 2), arc(5, 2)];
		separate(arcs);
		expect(arcs.map((a) => a.at)).toEqual([1, 3, 5]);
	});

	it('spreads a pile of arcs wanting one spot, centred on it', () => {
		const arcs = Array.from({ length: 5 }, () => arc(2, 1));
		separate(arcs);
		for (const gap of gaps(arcs)) expect(gap).toBeGreaterThanOrEqual(-1e-9);
		expect(arcs.reduce((sum, a) => sum + a.at, 0) / 5).toBeCloseTo(2, 5);
	});

	it('packs a ring that has no room to spare, across the seam too', () => {
		// 62 arcs of 0.1 nearly fill the circle (6.2 of 2π), all wanting to sit in one half of it.
		const arcs = Array.from({ length: 62 }, (_, i) => arc((i / 62) * Math.PI, 1));
		separate(arcs);
		for (const gap of gaps(arcs)) expect(gap).toBeGreaterThanOrEqual(-1e-6);
	});
});

describe('layoutRings of the whole tree', () => {
	for (const { name, graph } of allTestGraphs()) {
		it(`${name}: draws everyone once, nobody is the focus, nobody crowds`, () => {
			const layout = layoutRings(graph, null, {}, buildIndex(graph), selectWholeTree(graph));
			expect(layout.focusPersonId).toBeNull();
			expect(layout.people.map((p) => p.id).sort()).toEqual(graph.people.map((p) => p.id).sort());
			expect(crowding(layout)).toEqual([]);
		});
	}

	/** A dynasty of `count` cousins on each of six rows, every row marrying out of the next. */
	function wide(count: number) {
		const people: string[] = [];
		const unions: Array<{ id: string; partners: string[]; children: string[] }> = [];
		let previous: string[] = [];
		for (let row = 0; row < 6; row++) {
			const current: string[] = [];
			for (let i = 0; i < count; i++) current.push(`r${row}-${i}`);
			people.push(...current);
			// Pairs on the previous row each have a few children on this one.
			const perPair = Math.ceil(count / Math.max(1, previous.length / 2));
			for (let i = 0; i + 1 < previous.length; i += 2)
				unions.push({
					id: `u${row}-${i}`,
					partners: [previous[i], previous[i + 1]],
					children: current.slice((i / 2) * perPair, (i / 2 + 1) * perPair)
				});
			previous = current;
		}
		return makeGraph({ people, unions });
	}

	it('stays quick and uncrowded at 3,000 people', () => {
		const graph = wide(500);
		const index = buildIndex(graph);
		const selection = selectWholeTree(graph);
		let best = Infinity;
		let layout = layoutRings(graph, null, {}, index, selection);
		for (let i = 0; i < 3; i++) {
			const started = performance.now();
			layout = layoutRings(graph, null, {}, index, selection);
			best = Math.min(best, performance.now() - started);
		}
		expect(layout.people).toHaveLength(3000);
		expect(crowding(layout)).toEqual([]);
		// Measured at about 20 ms; the margin is for a loaded CI machine, not a slow layout.
		expect(best).toBeLessThan(100);
	});
});
