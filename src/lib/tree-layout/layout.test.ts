import { describe, it, expect } from 'vitest';
import { allContractViolations, countCrossings, findOverlaps } from './contract';
import { layoutFocusView } from './index';
import {
	allTestGraphs,
	CAPTURED_GRAPHS,
	makeGraph,
	personByName,
	SYNTHETIC_GRAPHS
} from './test-support';
import { CROSSING_CONFIGS, crossingKey } from './crossing-configs';
import baseline from './fixtures/crossings.baseline.json';
import {
	LAYOUT_METRICS,
	type ChildEdge,
	type FocusViewOptions,
	type RelationshipGraph,
	type TreeLayout
} from './types';

const SWEEP: FocusViewOptions[] = [
	{ ancestorDepth: 0, descendantDepth: 0 },
	{ ancestorDepth: 1, descendantDepth: 1 },
	{ ancestorDepth: 2, descendantDepth: 4 },
	{ ancestorDepth: 4, descendantDepth: 2 },
	{ ancestorDepth: 8, descendantDepth: 8 }
].flatMap((d) => [
	{ ...d, shouldIncludeSiblings: true },
	{ ...d, shouldIncludeSiblings: false }
]);

/**
 * Only a person with three or more unions can have a partner that cannot sit beside them, or
 * siblings who are partners: each hangs in their parents' row from their own place in it.
 */
const EXPECTED_NON_ADJACENT = new Set(['three-unions', 'siblings-as-partners']);

function layoutFor(graph: RelationshipGraph, name: string, options?: FocusViewOptions): TreeLayout {
	return layoutFocusView(graph, personByName(graph, name).id, options);
}

function captured(name: string): RelationshipGraph {
	return CAPTURED_GRAPHS.find((g) => g.name === name)!.graph;
}

function synthetic(name: string): RelationshipGraph {
	return SYNTHETIC_GRAPHS.find((g) => g.name === name)!.graph;
}

function childEdges(layout: TreeLayout): ChildEdge[] {
	return layout.edges.filter((e): e is ChildEdge => e.kind === 'child');
}

describe('layout contract sweeps', () => {
	for (const { name, graph } of allTestGraphs()) {
		it(`${name}: every person as focus honours the contract at every depth`, () => {
			for (const options of SWEEP) {
				for (const focus of graph.people) {
					const layout = layoutFocusView(graph, focus.id, options);
					const ctx = `${name} focus=${focus.displayName} ${JSON.stringify(options)}`;
					expect(allContractViolations(graph, layout), ctx).toEqual([]);
					expect(layout.misplacedPersonIds, ctx).toEqual([]);
					if (!EXPECTED_NON_ADJACENT.has(name)) expect(layout.nonAdjacentUnionIds, ctx).toEqual([]);
					expect(
						layout.people.find((p) => p.id === focus.id),
						ctx
					).toMatchObject({ x: 0, y: 0, role: 'focus' });

					// Bounds enclose everything drawn.
					for (const p of layout.people) {
						expect(p.x - LAYOUT_METRICS.cardWidth / 2).toBeGreaterThanOrEqual(layout.bounds.minX);
						expect(p.x + LAYOUT_METRICS.cardWidth / 2).toBeLessThanOrEqual(layout.bounds.maxX);
					}
				}
			}
		});

		it(`${name}: output is deterministic`, () => {
			for (const focus of graph.people) {
				const a = layoutFocusView(graph, focus.id, { ancestorDepth: 3, descendantDepth: 3 });
				const b = layoutFocusView(structuredClone(graph), focus.id, {
					ancestorDepth: 3,
					descendantDepth: 3
				});
				expect(JSON.stringify(b)).toBe(JSON.stringify(a));
			}
		});

		it(`${name}: crossings do not regress from the recorded baseline`, () => {
			const recorded = baseline as Record<string, number>;
			for (const focus of graph.people) {
				for (const config of CROSSING_CONFIGS) {
					const key = crossingKey(name, graph.people.indexOf(focus), config);
					const layout = layoutFocusView(graph, focus.id, config);
					expect(recorded[key], `no baseline for ${key}; run npm run tree:baseline`).toBeDefined();
					expect(countCrossings(layout), key).toBeLessThanOrEqual(recorded[key]);
				}
			}
		});
	}
});

describe('known bugs from the plan', () => {
	const simpsons = captured('simpsons');

	it('focusing Jessica draws Selma Bouvier beside Maude with their union between', () => {
		const layout = layoutFor(simpsons, 'Jessica Lovejoy');
		const maude = layout.people.find((p) => p.person.displayName === 'Maude Helen Lovejoy')!;
		const selma = layout.people.find((p) => p.person.displayName === 'Selma Bouvier')!;
		expect(selma).toBeDefined();
		expect(selma.y).toBe(maude.y);
		expect(Math.abs(selma.x - maude.x)).toBe(LAYOUT_METRICS.cardWidth + LAYOUT_METRICS.partnerGap);
		const union = layout.unions.find(
			(u) => u.union.partnerIds.includes(maude.id) && u.union.partnerIds.includes(selma.id)
		)!;
		expect(union.x).toBeCloseTo((maude.x + selma.x) / 2);
		expect(union.y).toBe(maude.y);
	});

	it('focusing Homer Simpson or Marjorie Bouvier draws Milhouse Van Houten beside Lisa', () => {
		for (const focus of ['Homer Jay Simpson', 'Marjorie Bouvier']) {
			const layout = layoutFor(simpsons, focus);
			const lisa = layout.people.find((p) => p.person.displayName === 'Lisa Marie Simpson')!;
			const milhouse = layout.people.find((p) => p.person.displayName === 'Milhouse Van Houten')!;
			expect(milhouse, focus).toBeDefined();
			expect(milhouse.y).toBe(lisa.y);
			expect(Math.abs(milhouse.x - lisa.x)).toBe(
				LAYOUT_METRICS.cardWidth + LAYOUT_METRICS.partnerGap
			);
		}
	});

	it("draws one edge per (union, child), carrying both parents' assertions", () => {
		const layout = layoutFor(simpsons, 'Homer Jay Simpson');
		const hannah = layoutFor(simpsons, 'Homer Jay Simpson', { descendantDepth: 3 });
		const hannahId = personByName(simpsons, 'Hannah Van Houten').id;
		const edges = childEdges(hannah).filter((e) => e.childId === hannahId);
		expect(edges).toHaveLength(1);
		expect(edges[0].assertions).toHaveLength(2);
		expect(edges[0].types).toEqual(['biological']);
		expect(layout.edges.filter((e) => e.kind === 'child').length).toBeGreaterThan(0);
	});

	it('shows the partner-depth boundary as a couple with a "+2" stub for their children', () => {
		const layout = layoutFor(simpsons, 'Jessica Lovejoy', { descendantDepth: 1 });
		expect(layout.people.some((p) => p.person.displayName === 'Selma Bouvier')).toBe(true);
		expect(layout.people.some((p) => p.person.displayName === 'Ralph Lovejoy')).toBe(false);
		const stub = layout.stubs.find((s) => s.kind === 'children' && s.count === 2)!;
		const union = layout.unions.find((u) => u.id === stub.unionId)!;
		expect(stub.y).toBeGreaterThan(union.y);
		expect(Math.abs(stub.x - union.x)).toBeLessThan(1);
		expect(layout.edges.some((e) => e.kind === 'stub' && e.stubId === stub.id)).toBe(true);
	});

	it("stubs a partner's undrawn family under the partner (focus Bart: Jessica's 3 children)", () => {
		const layout = layoutFor(simpsons, 'Bartholomew Jo-Jo Simpson');
		const jessica = layout.people.find((p) => p.person.displayName === 'Jessica Lovejoy')!;
		const stub = layout.stubs.find((s) => s.personId === jessica.id)!;
		expect(stub.count).toBe(3);
		expect(stub.x).toBe(jessica.x);
		expect(stub.y).toBe(jessica.y + LAYOUT_METRICS.rowHeight);
	});

	it('keeps siblings contiguous and toggles them', () => {
		const withSiblings = layoutFor(simpsons, 'Bartholomew Jo-Jo Simpson', {
			shouldIncludeSiblings: true
		});
		const without = layoutFor(simpsons, 'Bartholomew Jo-Jo Simpson', {
			shouldIncludeSiblings: false
		});
		expect(withSiblings.people.filter((p) => p.role === 'sibling')).toHaveLength(3);
		expect(without.people.filter((p) => p.role === 'sibling')).toHaveLength(0);
	});
});

describe('structures beyond the Simpsons', () => {
	it("keeps a later partner's hidden-children stub off the earlier union's children", () => {
		// Charles's children by Diana spread right under Camilla, whose own children (by another
		// partner) are a stub; the childless union between them used to hide the clash.
		const graph = makeGraph({
			people: [
				'Charles',
				'Diana',
				'Camilla',
				'Andrew',
				'Tom',
				'Laura',
				'William',
				'Harry',
				'Meghan'
			],
			unions: [
				{
					id: 'cd',
					partners: ['Charles', 'Diana'],
					marriageDate: '1981',
					children: ['William', 'Harry']
				},
				{ id: 'cc', partners: ['Charles', 'Camilla'], marriageDate: '2005' },
				{
					id: 'ca',
					partners: ['Camilla', 'Andrew'],
					marriageDate: '1973',
					children: ['Tom', 'Laura']
				},
				{ id: 'hm', partners: ['Harry', 'Meghan'] }
			]
		});
		const layout = layoutFocusView(graph, 'Charles', { ancestorDepth: 1, descendantDepth: 1 });
		expect(layout.stubs.map((s) => s.id)).toContain('stub:children:other:Camilla');
		expect(findOverlaps(layout)).toEqual([]);
	});

	it('draws a child of two unions once, with a secondary edge for the second union', () => {
		const rep = captured('representative-551');
		const layout = layoutFor(rep, 'Alice /Walker/');
		const david = personByName(rep, 'David /Smith/').id;
		expect(layout.people.filter((p) => p.id === david)).toHaveLength(1);
		const edges = childEdges(layout).filter((e) => e.childId === david);
		expect(edges).toHaveLength(2);
		expect(edges.filter((e) => e.isSecondaryPath)).toHaveLength(1);
		expect(layout.unions).toHaveLength(2);
		expect(layout.collapsedPersonIds).toContain(david);
	});

	it('draws a shared parent once between her two unions when focusing the child', () => {
		const rep = captured('representative-551');
		const layout = layoutFor(rep, 'David /Smith/');
		const alice = layout.people.find((p) => p.person.displayName === 'Alice /Walker/')!;
		const bob = layout.people.find((p) => p.person.displayName === 'Bob /Smith/')!;
		const carol = layout.people.find((p) => p.person.displayName === 'Carol /Jones/')!;
		expect(layout.people.filter((p) => p.id === alice.id)).toHaveLength(1);
		expect(bob.x).toBeLessThan(alice.x);
		expect(alice.x).toBeLessThan(carol.x);
		expect(layout.unions).toHaveLength(2);
		// The earlier marriage (1992) sits to the left, in chronological order.
		const earlier = layout.unions.find((u) => u.union.marriageDate?.includes('1992'))!;
		const later = layout.unions.find((u) => u.union.marriageDate?.includes('2008'))!;
		expect(earlier.x).toBeLessThan(later.x);
	});

	it('preserves adoptive and foster types on the merged edge', () => {
		const rep = captured('representative-551');
		const layout = layoutFor(rep, 'David /Smith/');
		const emily = personByName(rep, 'Emily /Foster-Child/').id;
		expect(childEdges(layout).find((e) => e.childId === emily)?.types).toEqual(['foster']);
		const david = personByName(rep, 'David /Smith/').id;
		const davidTypes = childEdges(layout)
			.filter((e) => e.childId === david)
			.map((e) => e.types.join());
		expect(davidTypes.sort()).toEqual(['adoptive', 'biological']);
	});

	it('renders pedigree collapse once with a dashed secondary path', () => {
		const layout = layoutFocusView(synthetic('cousin-marriage'), 'C', { ancestorDepth: 5 });
		expect(layout.people.filter((p) => p.id === 'G1')).toHaveLength(1);
		expect(layout.unions.filter((u) => u.id === 'ug')).toHaveLength(1);
		expect(layout.collapsedPersonIds).toEqual(expect.arrayContaining(['G1', 'G2']));
		const toGrandchildren = childEdges(layout).filter((e) => e.unionId === 'ug');
		expect(toGrandchildren).toHaveLength(2);
		expect(toGrandchildren.filter((e) => e.isSecondaryPath)).toHaveLength(1);
	});

	it('draws a union between two siblings once', () => {
		const layout = layoutFocusView(synthetic('siblings-as-partners'), 'Father');
		expect(layout.unions.map((u) => u.id).sort()).toEqual(['uother', 'uparents', 'usiblings']);
	});

	it('keeps repeated unions between the same pair as distinct nodes', () => {
		const layout = layoutFocusView(synthetic('repeated-union'), 'A');
		expect(layout.unions.map((u) => u.id).sort()).toEqual(['u1', 'u2']);
		const [a, b] = layout.unions;
		expect(a.x !== b.x || a.y !== b.y).toBe(true);
		expect(layout.people.filter((p) => p.id === 'B')).toHaveLength(1);
		expect(layout.edges.filter((e) => e.kind === 'partner')).toHaveLength(4);
	});

	it('draws a single-partner union and its children', () => {
		const layout = layoutFocusView(synthetic('childless-and-solo'), 'C');
		const union = layout.unions.find((u) => u.id === 'u2')!;
		const child = layout.people.find((p) => p.id === 'D')!;
		const parent = layout.people.find((p) => p.id === 'C')!;
		expect(union.isHanging).toBe(true);
		expect(child.x).toBe(union.x);
		expect(child.x).toBe(parent.x);
	});

	it('draws a childless couple', () => {
		const layout = layoutFocusView(synthetic('childless-and-solo'), 'A');
		expect(layout.unions.map((u) => u.id)).toEqual(['u1']);
		expect(layout.people.map((p) => p.id).sort()).toEqual(['A', 'B']);
	});

	it('draws parent-child links that have no union straight from the parent', () => {
		const layout = layoutFocusView(synthetic('direct-links-only'), 'Parent');
		const direct = childEdges(layout).filter((e) => e.unionId === null);
		expect(direct).toHaveLength(3);
		const parent = layout.people.find((p) => p.id === 'Parent')!;
		const kid1 = layout.people.find((p) => p.id === 'Kid1')!;
		const kid2 = layout.people.find((p) => p.id === 'Kid2')!;
		expect((kid1.x + kid2.x) / 2).toBe(parent.x);
		expect(direct.find((e) => e.childId === 'Kid2')?.types).toEqual(['adoptive']);
	});

	it("orders a person's unions chronologically around them and reports the one that cannot be adjacent", () => {
		const layout = layoutFocusView(synthetic('three-unions'), 'Pat');
		const x = (id: string) => layout.people.find((p) => p.id === id)!.x;
		expect(x('Q1')).toBeLessThan(x('Pat'));
		expect(x('Pat')).toBeLessThan(x('Q2'));
		expect(x('Q2')).toBeLessThan(x('Q3'));
		expect(layout.nonAdjacentUnionIds).toEqual(['u3']);
	});

	it('returns an empty layout for a missing focus', () => {
		expect(layoutFocusView(captured('simpsons'), 'nobody').people).toEqual([]);
		expect(layoutFocusView(captured('simpsons'), null).people).toEqual([]);
	});
});

describe('a relationship that names someone the graph has no record of', () => {
	// A window can arrive while rows are still being written; a card needs the record, so the layout
	// leaves that person out instead of drawing a card that throws.
	for (const { name, graph } of SYNTHETIC_GRAPHS) {
		it(`${name}: draws only people the graph holds`, () => {
			const focus = graph.people[0];
			const options = { ancestorDepth: 3, descendantDepth: 3 };
			const dropped = layoutFocusView(graph, focus.id, options).people.find(
				(p) => p.id !== focus.id
			)?.id;
			if (!dropped) return;

			const partial = { ...graph, people: graph.people.filter((p) => p.id !== dropped) };
			const layout = layoutFocusView(partial, focus.id, options);

			expect(layout.people.map((p) => p.id)).not.toContain(dropped);
			expect(layout.people.every((p) => p.person !== undefined)).toBe(true);

			// Nothing else may point at the missing card: the canvas looks every endpoint up by id.
			const placed = new Set(layout.people.map((p) => p.id));
			for (const edge of layout.edges) {
				if (edge.kind === 'partner')
					expect(placed.has(edge.personId), `partner edge to ${edge.personId}`).toBe(true);
				if (edge.kind === 'child')
					expect(placed.has(edge.childId), `child edge to ${edge.childId}`).toBe(true);
			}
			for (const stub of layout.stubs)
				if (stub.personId) expect(placed.has(stub.personId), `stub of ${stub.personId}`).toBe(true);
			for (const collapser of layout.collapsers)
				expect(placed.has(collapser.personId), `collapser of ${collapser.personId}`).toBe(true);
		});
	}
});
