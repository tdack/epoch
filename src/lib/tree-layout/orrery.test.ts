import { describe, expect, it } from 'vitest';
import { buildIndex } from './graph-index';
import { layoutOrrery, ORRERY_BINARY_UNITS, ORRERY_ITERATIONS, type OrreryLayout } from './orrery';
import { buildOrbitPlan, orbitPositions } from './orrery-orbit';
import type { Vec3 } from './orrery-simulation';
import { selectFocusSubgraph } from './select';
import { allTestGraphs, makeGraph, personByName } from './test-support';
import type { FocusViewOptions } from './types';

const WIDE: FocusViewOptions = {
	ancestorDepth: 8,
	descendantDepth: 8,
	collateralDepth: 2,
	shouldIncludePartnerOrigins: true
};

const distance = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const byId = (layout: OrreryLayout) => new Map(layout.people.map((p) => [p.id, p]));
const mid = (ids: string[], from: (id: string) => Vec3): Vec3 => ({
	x: ids.reduce((s, id) => s + from(id).x, 0) / ids.length,
	y: ids.reduce((s, id) => s + from(id).y, 0) / ids.length,
	z: ids.reduce((s, id) => s + from(id).z, 0) / ids.length
});

/** A binary tree of couples: every couple has two children, each of whom partners an outsider. */
function dynasty(generations: number) {
	const people = ['a0', 'b0'];
	const unions = [{ id: 'u0', partners: ['a0', 'b0'], children: [] as string[] }];
	let level = [unions[0]];
	for (let g = 1; g < generations; g++) {
		const next: typeof unions = [];
		for (const parents of level)
			for (let k = 0; k < 2; k++) {
				const child = `c${g}_${next.length}`;
				const spouse = `s${g}_${next.length}`;
				people.push(child, spouse);
				parents.children.push(child);
				next.push({ id: `u${g}_${next.length}`, partners: [child, spouse], children: [] });
			}
		unions.push(...next);
		level = next;
	}
	return makeGraph({ people, unions });
}

describe('layoutOrrery', () => {
	for (const { name, graph } of allTestGraphs()) {
		it(`${name}: draws exactly the people the selection draws, once each`, () => {
			const index = buildIndex(graph);
			const focus = graph.people[0];
			const layout = layoutOrrery(graph, focus.id, {}, index);
			const selection = selectFocusSubgraph(graph, focus.id, {}, index)!;
			const ids = layout.people.map((p) => p.id);
			expect(new Set(ids).size).toBe(ids.length);
			expect(new Set(ids)).toEqual(new Set(selection.people.map((p) => p.id)));
		});

		it(`${name}: gives the same positions every time, with the focus at the origin`, () => {
			const focus = graph.people[0];
			const first = layoutOrrery(graph, focus.id, WIDE);
			expect(layoutOrrery(graph, focus.id, WIDE)).toEqual(first);
			const at = byId(first).get(focus.id)!;
			expect([at.x, at.y, at.z]).toEqual([0, 0, 0]);
			for (const p of first.people) expect([p.x, p.y, p.z].every(Number.isFinite)).toBe(true);
		});

		it(`${name}: keeps union partners near the binary distance`, () => {
			const focus = graph.people[0];
			const layout = layoutOrrery(graph, focus.id, WIDE);
			const at = byId(layout);
			for (const union of layout.unions) {
				if (union.partnerIds.length < 2) continue;
				const [a, b] = union.partnerIds.map((id) => at.get(id)!);
				// Children and neighbours pull on a binary, so it is a tolerance, not an equality.
				expect(Math.abs(distance(a, b) - union.distance) / union.distance).toBeLessThan(0.4);
			}
		});
	}

	it('is empty without a focus person', () => {
		const { graph } = allTestGraphs()[0];
		expect(layoutOrrery(graph, null).people).toEqual([]);
		expect(layoutOrrery(graph, 'no-such-person').people).toEqual([]);
	});

	it('holds a first union at the binary distance, within a tenth', () => {
		const graph = makeGraph({
			people: ['A', 'B', 'K'],
			unions: [{ id: 'u', partners: ['A', 'B'], children: ['K'] }]
		});
		const layout = layoutOrrery(graph, 'A');
		const at = byId(layout);
		expect(layout.unions[0].distance).toBe(ORRERY_BINARY_UNITS);
		expect(Math.abs(distance(at.get('A')!, at.get('B')!) - ORRERY_BINARY_UNITS)).toBeLessThan(
			ORRERY_BINARY_UNITS * 0.1
		);
	});

	it('settles a child nearer its own parents’ barycentre than a cousin of the same generation', () => {
		const graph = makeGraph({
			people: ['A', 'B', 'K1', 'K2', 'C', 'D', 'L1', 'L2', 'Z'],
			unions: [
				{ id: 'u1', partners: ['A', 'B'], children: ['K1', 'K2'] },
				{ id: 'u2', partners: ['C', 'D'], children: ['L1', 'L2'] },
				{ id: 'u3', partners: ['K1', 'L1'], children: ['Z'] }
			]
		});
		const at = byId(layoutOrrery(graph, 'Z', WIDE));
		const here = (id: string) => at.get(id)!;
		const ab = mid(['A', 'B'], here);
		const cd = mid(['C', 'D'], here);
		expect(distance(here('K2'), ab)).toBeLessThan(distance(here('L2'), ab));
		expect(distance(here('L2'), cd)).toBeLessThan(distance(here('K2'), cd));
	});

	it('settles children nearer their barycentre than the median other star of their generation on the Simpsons', () => {
		const { graph } = allTestGraphs().find((g) => g.name === 'simpsons')!;
		const layout = layoutOrrery(graph, personByName(graph, 'Dermot Lovejoy').id, WIDE);
		const at = byId(layout);
		const unionAt = new Map(layout.unions.map((u) => [u.id, u]));
		let checked = 0;
		for (const link of layout.childLinks) {
			if (link.fromUnionId === null) continue;
			const union = unionAt.get(link.fromUnionId)!;
			const child = at.get(link.childId)!;
			const siblingIds = new Set(
				layout.childLinks.filter((l) => l.fromUnionId === union.id).map((l) => l.childId)
			);
			const others = layout.people.filter(
				(p) =>
					p.generation === child.generation &&
					!union.partnerIds.includes(p.id) &&
					!siblingIds.has(p.id)
			);
			if (others.length === 0) continue;
			const median = others.map((o) => distance(o, union)).sort((a, b) => a - b)[
				others.length >> 1
			];
			expect(distance(child, union)).toBeLessThanOrEqual(median);
			checked++;
		}
		expect(checked).toBeGreaterThan(0);
	});

	it('gathers a person with several unions, their partners and children into one cluster', () => {
		const { graph } = allTestGraphs().find((g) => g.name === 'three-unions')!;
		const layout = layoutOrrery(graph, 'Pat', WIDE);
		const at = byId(layout);
		expect(layout.people).toHaveLength(7);
		const pat = at.get('Pat')!;
		const spans = layout.unions.map((u) => u.distance);
		// The shared star's binaries step outward: a hierarchical system, not three equal pairs.
		expect(spans[1]).toBeGreaterThan(spans[0]);
		expect(spans[2]).toBeGreaterThan(spans[1]);
		for (const q of ['Q1', 'Q2', 'Q3']) expect(distance(pat, at.get(q)!)).toBeLessThan(10);
		for (const k of ['K1', 'K2', 'K3']) expect(distance(pat, at.get(k)!)).toBeLessThan(16);
		for (const a of layout.people)
			for (const b of layout.people) expect(distance(a, b)).toBeLessThan(30);
	});

	it('shares one binary between repeated unions of the same pair', () => {
		const { graph } = allTestGraphs().find((g) => g.name === 'repeated-union-shared-child')!;
		const layout = layoutOrrery(graph, 'A', WIDE);
		const at = byId(layout);
		expect(layout.unions).toHaveLength(3);
		expect(distance(at.get('A')!, at.get('B')!)).toBeLessThan(ORRERY_BINARY_UNITS * 1.6);
	});

	it('stays within its iteration budget', () => {
		const layout = layoutOrrery(dynasty(5), 'a0', WIDE);
		expect(layout.iterations).toBeGreaterThan(0);
		expect(layout.iterations).toBeLessThanOrEqual(ORRERY_ITERATIONS);
	});

	it('holds binaries and is deterministic with the Barnes–Hut tree, too', () => {
		const graph = dynasty(6);
		const exact = layoutOrrery(graph, 'a0', WIDE, undefined, { barnesHutThreshold: 100000 });
		const tree = layoutOrrery(graph, 'a0', WIDE, undefined, { barnesHutThreshold: 0 });
		expect(layoutOrrery(graph, 'a0', WIDE, undefined, { barnesHutThreshold: 0 })).toEqual(tree);
		const at = byId(tree);
		for (const union of tree.unions) {
			const [a, b] = union.partnerIds.map((id) => at.get(id)!);
			expect(Math.abs(distance(a, b) - union.distance) / union.distance).toBeLessThan(0.4);
		}
		// Approximate forces give a different but similarly sized cluster.
		const radius = (l: OrreryLayout) => Math.max(...l.people.map((p) => Math.hypot(p.x, p.z)));
		expect(radius(tree)).toBeGreaterThan(radius(exact) * 0.5);
		expect(radius(tree)).toBeLessThan(radius(exact) * 2);
	});

	it('lays out a 254-person dynasty well inside a second', () => {
		const started = performance.now();
		const layout = layoutOrrery(dynasty(7), 'a0', { ...WIDE, ancestorDepth: 2 });
		const ms = performance.now() - started;
		expect(layout.people).toHaveLength(254);
		// The target is 100 ms; this bound is loose so a loaded CI machine does not flake.
		expect(ms).toBeLessThan(1000);
	});
});

describe('orbital drift', () => {
	const layout = layoutOrrery(dynasty(5), 'a0', WIDE);
	const plan = buildOrbitPlan(layout);

	it('starts exactly on the layout', () => {
		const out = new Map<string, Vec3>();
		orbitPositions(layout, plan, 0, out);
		for (const p of layout.people) expect(distance(out.get(p.id)!, p)).toBeLessThan(1e-9);
	});

	it('moves people but keeps every binary rigid', () => {
		const out = new Map<string, Vec3>();
		orbitPositions(layout, plan, 40, out);
		const at = byId(layout);
		expect(layout.people.some((p) => distance(out.get(p.id)!, p) > 0.1)).toBe(true);
		for (const union of layout.unions) {
			const [a, b] = union.partnerIds;
			expect(distance(out.get(a)!, out.get(b)!)).toBeCloseTo(distance(at.get(a)!, at.get(b)!), 6);
		}
	});

	it('is a pure function of time', () => {
		const a = new Map<string, Vec3>();
		const b = new Map<string, Vec3>();
		orbitPositions(layout, plan, 12.5, a);
		orbitPositions(layout, plan, 99, b);
		orbitPositions(layout, plan, 12.5, b);
		for (const p of layout.people) expect(b.get(p.id)).toEqual(a.get(p.id));
	});
});
