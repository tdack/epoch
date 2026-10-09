import { describe, expect, it } from 'vitest';
import { buildIndex } from './graph-index';
import {
	countRibbonCrossings,
	layoutRibbons,
	RIBBON_STRAND_KINDS,
	type RibbonsLayout
} from './ribbons';
import { linkKey } from './highlight';
import { selectFocusSubgraph } from './select';
import { selectWholeTree } from './whole-tree';
import { allTestGraphs, makeGraph, personByName, SYNTHETIC_GRAPHS } from './test-support';

/**
 * Two roots' worth of descendants who marry across families, six generations deep, with every list
 * shuffled by a seeded generator so the selection's own order is not already a good one.
 */
function dynasty() {
	let seed = 12345;
	const next = () => (seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 4294967296;
	const shuffle = <T>(items: T[]) => {
		const copy = [...items];
		for (let i = copy.length - 1; i > 0; i--) {
			const j = Math.floor(next() * (i + 1));
			[copy[i], copy[j]] = [copy[j], copy[i]];
		}
		return copy;
	};
	const people: string[] = [];
	const unions: Array<{ id: string; partners: string[]; children: string[] }> = [];
	let row = ['a0', 'a1', 'b0', 'b1'];
	people.push(...row);
	const byGeneration: string[][] = [row];
	for (let g = 1; g <= 6; g++) {
		const parentOf = new Map<string, string>();
		const next_: string[] = [];
		const order = shuffle(row);
		for (let i = 0; i + 1 < order.length; i += 2) {
			const id = `u${g}-${i}`;
			const children = Array.from(
				{ length: 3 + Math.floor(next() * 2) },
				(_, k) => `p${g}-${i}-${k}`
			);
			children.forEach((c) => parentOf.set(c, id));
			unions.push({ id, partners: [order[i], order[i + 1]], children });
			next_.push(...children);
		}
		people.push(...next_);
		byGeneration.push(next_);
		row = next_;
	}
	return {
		graph: makeGraph({ people: shuffle(people), unions: shuffle(unions) }),
		focusIds: [byGeneration[1][0], byGeneration[2][3], byGeneration[3][5]]
	};
}

/** Couples marry within their row, three children each, until there are about `total` people. */
function wideTree(total: number) {
	const people: string[] = [];
	const unions: Array<{ id: string; partners: string[]; children: string[] }> = [];
	let row = Array.from({ length: 40 }, (_, i) => `r0-${i}`);
	people.push(...row);
	for (let g = 1; people.length < total; g++) {
		const children: string[] = [];
		for (let i = 0; i + 1 < row.length; i += 2) {
			const kids = [0, 1, 2].map((k) => `p${g}-${i}-${k}`);
			unions.push({ id: `u${g}-${i}`, partners: [row[i], row[i + 1]], children: kids });
			children.push(...kids);
		}
		people.push(...children);
		row = children;
	}
	return makeGraph({ people, unions });
}

const WIDE = {
	ancestorDepth: 8,
	descendantDepth: 8,
	collateralDepth: 2,
	shouldIncludePartnerOrigins: true,
	shouldIncludeStepFamilies: true
};

const entries = (layout: RibbonsLayout, personId: string) =>
	layout.strands.filter((s) => s.personId === personId && s.kind === RIBBON_STRAND_KINDS.ENTRY);

describe('layoutRibbons', () => {
	for (const { name, graph } of allTestGraphs()) {
		const focus = graph.people[0];
		const index = buildIndex(graph);
		const layout = layoutRibbons(graph, focus.id, {}, index);

		it(`${name}: draws exactly the people the selection draws, once each`, () => {
			const selection = selectFocusSubgraph(graph, focus.id, {}, index)!;
			const ids = layout.people.map((p) => p.id);
			expect(new Set(ids).size).toBe(ids.length);
			expect(new Set(ids)).toEqual(new Set(selection.people.map((p) => p.id)));
		});

		it(`${name}: every person has exactly one entry segment`, () => {
			for (const p of layout.people) expect(entries(layout, p.id)).toHaveLength(1);
		});

		it(`${name}: a union with two or more drawn partners has a knot and a join per partner`, () => {
			for (const u of layout.unions) {
				expect(u.partnerIds.length).toBeGreaterThan(0);
				for (const [i, partnerId] of u.partnerIds.entries()) {
					const joins = layout.strands.filter(
						(s) =>
							s.kind === RIBBON_STRAND_KINDS.JOIN && s.unionId === u.id && s.personId === partnerId
					);
					expect(joins).toHaveLength(1);
					expect(joins[0].braidIndex).toBe(i);
					expect(joins[0].braidCount).toBe(u.partnerIds.length);
					expect(joins[0].to).toEqual({ x: u.x, y: u.y, z: u.z });
				}
			}
		});

		it(`${name}: children leave their own union's knot, and flow runs downward`, () => {
			const knots = new Map(layout.unions.map((u) => [u.id, u]));
			for (const s of layout.strands.filter((s) => s.kind !== RIBBON_STRAND_KINDS.JOIN)) {
				if (s.unionId !== null) {
					const knot = knots.get(s.unionId)!;
					expect(s.from).toEqual({ x: knot.x, y: knot.y, z: knot.z });
					const child = layout.people.find((p) => p.id === s.personId)!;
					expect(child.person.parentsByUnion[s.unionId]).toBeDefined();
				}
				expect(s.from.y).toBeGreaterThan(s.to.y - 1e-9);
			}
		});

		it(`${name}: is deterministic`, () => {
			expect(layoutRibbons(graph, focus.id, {}, buildIndex(graph))).toEqual(layout);
		});

		it(`${name}: nobody shares a spot`, () => {
			const spots = layout.people.map(
				(p) => `${p.x.toFixed(3)},${p.y.toFixed(3)},${p.z.toFixed(3)}`
			);
			expect(new Set(spots).size).toBe(spots.length);
		});
	}

	it('splits a person with several unions to each knot, in union order', () => {
		const graph = SYNTHETIC_GRAPHS.find((g) => g.name === 'three-unions')!.graph;
		const pat = personByName(graph, 'Pat');
		const layout = layoutRibbons(graph, pat.id);
		const joins = layout.strands.filter(
			(s) => s.personId === pat.id && s.kind === RIBBON_STRAND_KINDS.JOIN
		);
		expect(joins.map((s) => s.unionId)).toEqual(['u1', 'u2', 'u3']);
		expect(new Set(joins.map((s) => `${s.to.x},${s.to.z}`)).size).toBe(3);
		// Each child leaves the knot of the union it belongs to.
		for (const [kid, union] of [
			['K1', 'u1'],
			['K2', 'u2'],
			['K3', 'u3']
		]) {
			const entry = entries(layout, personByName(graph, kid).id)[0];
			expect(entry.unionId).toBe(union);
		}
	});

	it('keeps repeated unions between the same pair distinct, with extra lines for a shared child', () => {
		const graph = SYNTHETIC_GRAPHS.find((g) => g.name === 'repeated-union-shared-child')!.graph;
		const layout = layoutRibbons(graph, personByName(graph, 'K').id);
		expect(layout.unions.map((u) => u.id).sort()).toEqual(['u1', 'u2', 'u3']);
		const kid = personByName(graph, 'K');
		const mine = layout.strands.filter(
			(s) => s.personId === kid.id && s.kind !== RIBBON_STRAND_KINDS.JOIN
		);
		expect(mine.filter((s) => s.kind === RIBBON_STRAND_KINDS.ENTRY)).toHaveLength(1);
		expect(mine.filter((s) => s.kind === RIBBON_STRAND_KINDS.EXTRA_ENTRY)).toHaveLength(2);
	});

	it('draws a lone parent link from the parent, and a one-partner union still has a knot', () => {
		const direct = SYNTHETIC_GRAPHS.find((g) => g.name === 'direct-links-only')!.graph;
		const layout = layoutRibbons(direct, personByName(direct, 'Parent').id);
		const kid = entries(layout, personByName(direct, 'Kid1').id)[0];
		expect(kid.unionId).toBeNull();
		expect(kid.fromPersonId).toBe(personByName(direct, 'Parent').id);
		const solo = SYNTHETIC_GRAPHS.find((g) => g.name === 'childless-and-solo')!.graph;
		const soloLayout = layoutRibbons(solo, personByName(solo, 'C').id);
		expect(soloLayout.unions.find((u) => u.id === 'u2')?.partnerIds).toHaveLength(1);
		expect(entries(soloLayout, personByName(solo, 'D').id)[0].unionId).toBe('u2');
	});

	it('draws a person reached by two paths once', () => {
		const graph = SYNTHETIC_GRAPHS.find((g) => g.name === 'cousin-marriage')!.graph;
		const layout = layoutRibbons(graph, personByName(graph, 'C').id);
		expect(layout.people.filter((p) => p.person.displayName === 'G1')).toHaveLength(1);
		expect(layout.collapsedPersonIds.length).toBeGreaterThan(0);
	});

	it('crossings on a large interlocking dynasty are no worse than the unordered baseline', () => {
		const { graph, focusIds } = dynasty();
		const index = buildIndex(graph);
		let didImprove = false;
		for (const focusId of focusIds) {
			const options = WIDE;
			const ordered = countRibbonCrossings(layoutRibbons(graph, focusId, options, index));
			const baseline = countRibbonCrossings(layoutRibbons(graph, focusId, options, index, 'input'));
			expect(ordered).toBeLessThanOrEqual(baseline);
			if (ordered < baseline) didImprove = true;
		}
		expect(didImprove).toBe(true);
	});

	it('lays out a 200-person tree promptly', () => {
		const { graph, focusIds } = dynasty();
		const index = buildIndex(graph);
		const options = WIDE;
		layoutRibbons(graph, focusIds[0], options, index);
		const started = performance.now();
		const layout = layoutRibbons(graph, focusIds[0], options, index);
		// The target is 100 ms on the owner's machine; the bound here only catches blow-ups.
		expect(performance.now() - started).toBeLessThan(500);
		expect(layout.people.length).toBeGreaterThan(180);
	});

	for (const { name, graph } of allTestGraphs()) {
		it(`${name}: every entry strand names a drawn parent-child line, and nothing else does`, () => {
			const layout = layoutRibbons(graph, graph.people[0].id, WIDE);
			const keys = new Set(layout.childLinks.map(linkKey));
			for (const s of layout.strands) {
				const isLine =
					!s.isStub &&
					(s.kind === RIBBON_STRAND_KINDS.ENTRY || s.kind === RIBBON_STRAND_KINDS.EXTRA_ENTRY);
				if (isLine) expect(keys.has(s.linkKey!)).toBe(true);
				else expect(s.linkKey).toBeNull();
			}
			const drawn = layout.strands.filter((s) => s.linkKey !== null).map((s) => s.linkKey);
			expect(new Set(drawn).size).toBe(drawn.length);
		});
	}

	it('draws a whole tree from row 0 down, with nobody as the focus', () => {
		const graph = wideTree(300);
		const layout = layoutRibbons(graph, null, {}, undefined, 'sweep', selectWholeTree(graph));
		expect(layout.focusPersonId).toBeNull();
		expect(layout.people).toHaveLength(graph.people.length);
		const rows = [...new Set(layout.people.map((p) => p.generation))].sort((a, b) => a - b);
		expect(rows[0]).toBe(0);
		// Older rows sit higher: y falls as the row number rises.
		const yOfRow = rows.map((g) => layout.people.find((p) => p.generation === g)!.y);
		expect(yOfRow).toEqual([...yOfRow].sort((a, b) => b - a));
		expect(new Set(yOfRow).size).toBe(rows.length);
		// Every ribbon is stub-fed only in row 0.
		for (const s of layout.strands.filter((x) => x.isStub))
			expect(layout.people.find((p) => p.id === s.personId)!.generation).toBe(0);
	});

	it('lays out a whole tree of about 3,000 people in good time', () => {
		const graph = wideTree(3000);
		const selection = selectWholeTree(graph);
		const started = performance.now();
		const layout = layoutRibbons(graph, null, {}, undefined, 'sweep', selection);
		const elapsed = performance.now() - started;
		expect(layout.people.length).toBeGreaterThanOrEqual(3000);
		// Measured well inside this on a laptop; the bound only catches a blow-up.
		expect(elapsed).toBeLessThan(5000);
	});

	it('is empty without a focus person', () => {
		const { graph } = allTestGraphs()[0];
		expect(layoutRibbons(graph, null).people).toEqual([]);
		expect(layoutRibbons(graph, 'no-such-person').people).toEqual([]);
	});
});
