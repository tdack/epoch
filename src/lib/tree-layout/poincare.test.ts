import { describe, expect, it } from 'vitest';
import { buildIndex } from './graph-index';
import { layoutPoincare } from './poincare';
import { selectFocusSubgraph } from './select';
import { allTestGraphs, makeGraph } from './test-support';
import { selectWholeTree } from './whole-tree';

describe('layoutPoincare', () => {
	for (const { name, graph } of allTestGraphs()) {
		it(`${name}: draws exactly the people the selection draws, once each`, () => {
			const index = buildIndex(graph);
			const focus = graph.people[0];
			const layout = layoutPoincare(graph, focus.id, {}, index);
			const selection = selectFocusSubgraph(graph, focus.id, {}, index)!;
			const ids = layout.people.map((p) => p.id);
			expect(new Set(ids).size).toBe(ids.length);
			expect(new Set(ids)).toEqual(new Set(selection.people.map((p) => p.id)));
		});
	}

	it('is empty without a focus person', () => {
		const { graph } = allTestGraphs()[0];
		expect(layoutPoincare(graph, null).people).toEqual([]);
		expect(layoutPoincare(graph, 'no-such-person').people).toEqual([]);
	});
});

const dist = (p: { x: number; y: number; z: number }) => Math.hypot(p.x, p.y, p.z);

/** Dates are injected because the captured Simpsons graph carries none. */
function datedSimpsons(isPrivateId?: string, focusIndex = 0) {
	const graph = structuredClone(allTestGraphs().find((g) => g.name === 'simpsons')!.graph);
	const index = buildIndex(graph);
	const focus = graph.people[focusIndex];
	const selection = selectFocusSubgraph(graph, focus.id, { ancestorDepth: 4 }, index)!;
	const generationOf = new Map(selection.people.map((p) => [p.id, p.generation]));
	const undatedPartnerIds: string[] = [];
	for (const person of graph.people) {
		const generation = generationOf.get(person.id);
		if (generation === undefined) continue;
		const hasParents = Object.keys(person.parentsByUnion).length > 0;
		if (hasParents) person.birthDate = String(1960 + generation * 28);
		else undatedPartnerIds.push(person.id);
		if (person.id === isPrivateId) person.isPrivate = true;
	}
	return { graph, focus, generationOf, undatedPartnerIds, selection };
}

describe('layoutPoincare placement', () => {
	it('keeps every person and union knot strictly inside the unit ball', () => {
		for (const { name, graph } of allTestGraphs()) {
			const layout = layoutPoincare(graph, graph.people[0].id);
			for (const p of layout.people) expect(dist(p), `${name} ${p.id}`).toBeLessThan(1);
			for (const u of layout.unions) expect(dist(u), `${name} ${u.id}`).toBeLessThan(1);
			for (const p of layout.people) expect(p.radius).toBeGreaterThan(0);
		}
	});

	it('puts undated partners at their partner’s latitude and the oldest highest', () => {
		let checked = 0;
		const count = datedSimpsons().graph.people.length;
		for (let focusIndex = 0; focusIndex < count; focusIndex++) {
			const { graph, focus, undatedPartnerIds } = datedSimpsons(undefined, focusIndex);
			const layout = layoutPoincare(graph, focus.id, { ancestorDepth: 4 });
			const byId = new Map(layout.people.map((p) => [p.id, p]));
			for (const union of layout.unions) {
				const [a, b] = union.partnerIds.map((id) => byId.get(id)!);
				if (!b) continue;
				expect(a.y).toBeCloseTo(b.y, 6);
				if (undatedPartnerIds.includes(a.id) !== undatedPartnerIds.includes(b.id)) checked++;
			}
			// A child stands below (younger than) its parents.
			for (const link of layout.childLinks)
				for (const parentId of link.parentIds)
					expect(byId.get(link.childId)!.y).toBeLessThan(byId.get(parentId)!.y);
			if (layout.people.length > 0) {
				expect(layout.hasDates).toBe(true);
				expect(layout.ticks.length).toBeGreaterThan(0);
			}
		}
		expect(checked).toBeGreaterThan(0);
	});

	it('draws heights from generations and no year labels without any dates', () => {
		const { graph } = allTestGraphs().find((g) => g.name === 'simpsons')!;
		const layout = layoutPoincare(graph, graph.people[0].id);
		expect(layout.hasDates).toBe(false);
		expect(layout.ticks).toEqual([]);
	});

	it('is deterministic', () => {
		const { graph, focus } = datedSimpsons();
		const first = layoutPoincare(graph, focus.id, { ancestorDepth: 4 });
		const second = layoutPoincare(graph, focus.id, { ancestorDepth: 4 });
		expect(JSON.stringify(first)).toBe(JSON.stringify(second));
	});

	it('places the focus line nearer the axis than the cousins of the same slice', () => {
		const graph = allTestGraphs().find((g) => g.name === 'simpsons')!.graph;
		const layout = layoutPoincare(graph, graph.people[0].id, { collateralDepth: 2 });
		const reach = (band: number) => {
			const rs = layout.people.filter((p) => p.band === band).map((p) => Math.hypot(p.x, p.z));
			return rs.reduce((a, b) => a + b, 0) / Math.max(rs.length, 1);
		};
		expect(reach(0)).toBeLessThan(reach(2));
	});

	it('does not let a private person’s recorded dates move anyone, themselves included', () => {
		const base = datedSimpsons();
		const target = base.selection.people.find(
			(p) => p.id !== base.focus.id && p.generation === -1
		)!.id;
		const withDate = datedSimpsons(target);
		const without = datedSimpsons(target);
		const person = (d: typeof base) => d.graph.people.find((p) => p.id === target)!;
		person(withDate).birthDate = '1500';
		person(without).birthDate = '1990';
		const opts = { ancestorDepth: 4 };
		const a = layoutPoincare(withDate.graph, withDate.focus.id, opts);
		const b = layoutPoincare(without.graph, without.focus.id, opts);
		const strip = (l: typeof a) =>
			JSON.stringify({ ...l, people: l.people.map(({ person: _p, ...rest }) => rest) });
		expect(strip(a)).toBe(strip(b));
	});
});

describe('layoutPoincare whole tree', () => {
	it('draws everyone once with no focus, inside the ball, on every fixture', () => {
		for (const { name, graph } of allTestGraphs()) {
			const selection = selectWholeTree(graph);
			const layout = layoutPoincare(graph, null, {}, buildIndex(graph), selection);
			expect(layout.focusPersonId, name).toBeNull();
			expect(layout.people.map((p) => p.id).sort(), name).toEqual(
				graph.people.map((p) => p.id).sort()
			);
			for (const p of layout.people) expect(dist(p), `${name} ${p.id}`).toBeLessThan(1);
		}
	});

	it('is deterministic for a whole tree', () => {
		const { graph } = allTestGraphs()[0];
		const run = () => layoutPoincare(graph, null, {}, buildIndex(graph), selectWholeTree(graph));
		expect(run()).toEqual(run());
	});

	it('keeps spheres of a wide tree apart and stays quick', () => {
		// 150 unconnected families, each two partners and three children: wide rows that collide.
		const people: string[] = [];
		const unions: Array<{ id: string; partners: string[]; children: string[] }> = [];
		for (let f = 0; f < 150; f++) {
			const ids = ['a', 'b', 'c', 'd', 'e'].map((k) => `${k}${f}`);
			people.push(...ids);
			unions.push({ id: `u${f}`, partners: ids.slice(0, 2), children: ids.slice(2) });
		}
		const graph = makeGraph({ people, unions });
		const started = performance.now();
		const layout = layoutPoincare(graph, null, {}, buildIndex(graph), selectWholeTree(graph));
		// Generous: the point is that it is not the 8 s a full pair scan took at 3,000 people.
		expect(performance.now() - started).toBeLessThan(4000);
		expect(layout.people).toHaveLength(750);
		let overlaps = 0;
		for (let i = 0; i < layout.people.length; i++)
			for (let j = i + 1; j < layout.people.length; j++) {
				const a = layout.people[i];
				const b = layout.people[j];
				if (Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) < (a.radius + b.radius) * 0.9) overlaps++;
			}
		// The pass is best-effort, 30 sweeps; almost no pair may still be touching.
		expect(overlaps).toBeLessThan(layout.people.length * 0.02);
	});
});
