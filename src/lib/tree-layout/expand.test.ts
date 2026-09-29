import { describe, it, expect } from 'vitest';
import { allContractViolations } from './contract';
import { filterParentChildTypes, layoutFocusView } from './index';
import { allTestGraphs, CAPTURED_GRAPHS, personByName } from './test-support';
import type { ChildEdge, FocusViewOptions, RelationshipGraph, TreeLayout } from './types';

const DEPTHS: FocusViewOptions[] = [
	{ ancestorDepth: 1, descendantDepth: 1 },
	{ ancestorDepth: 2, descendantDepth: 2, shouldIncludeSiblings: false },
	{ ancestorDepth: 3, descendantDepth: 3 }
];

/** Expand every stub currently shown, one round at a time, until none remain. */
function expandUntilNoStubs(graph: RelationshipGraph, focusId: string, base: FocusViewOptions) {
	const expandedStubIds: string[] = [];
	const rounds: TreeLayout[] = [];
	let layout = layoutFocusView(graph, focusId, { ...base, expandedStubIds });
	rounds.push(layout);
	for (let i = 0; i < 40 && layout.stubs.length > 0; i++) {
		expandedStubIds.push(...layout.stubs.map((s) => s.id));
		layout = layoutFocusView(graph, focusId, { ...base, expandedStubIds });
		rounds.push(layout);
	}
	return { rounds, expandedStubIds };
}

function expectClean(graph: RelationshipGraph, layout: TreeLayout, ctx: string) {
	expect(allContractViolations(graph, layout), ctx).toEqual([]);
	expect(layout.misplacedPersonIds, ctx).toEqual([]);
}

function captured(name: string): RelationshipGraph {
	return CAPTURED_GRAPHS.find((g) => g.name === name)!.graph;
}

describe('stub expansion', () => {
	for (const { name, graph } of allTestGraphs()) {
		it(`${name}: expanding stubs keeps the contract and never hides anyone`, () => {
			for (const base of DEPTHS) {
				for (const focus of graph.people) {
					const { rounds } = expandUntilNoStubs(graph, focus.id, base);
					const ctx = `${name} focus=${focus.displayName} ${JSON.stringify(base)}`;
					let previous = new Set<string>();
					rounds.forEach((layout, i) => {
						expectClean(graph, layout, `${ctx} round ${i}`);
						const now = new Set(layout.people.map((p) => p.id));
						for (const id of previous) expect(now.has(id), `${ctx} round ${i} lost ${id}`).toBe(true);
						previous = now;
					});
					expect(rounds.at(-1)!.stubs, `${ctx} still has stubs`).toEqual([]);
				}
			}
		});

		it(`${name}: collapsing an expansion restores the original layout`, () => {
			for (const focus of graph.people) {
				const base = { ancestorDepth: 1, descendantDepth: 1 };
				const before = layoutFocusView(graph, focus.id, base);
				if (before.stubs.length === 0) continue;
				const expanded = layoutFocusView(graph, focus.id, { ...base, expandedStubIds: [before.stubs[0].id] });
				expect(expanded.collapsers.map((c) => c.stubId), focus.displayName).toContain(before.stubs[0].id);
				const collapsed = layoutFocusView(graph, focus.id, { ...base, expandedStubIds: [] });
				expect(JSON.stringify(collapsed)).toBe(JSON.stringify(before));
			}
		});
	}

	it('offers one collapser per expanded stub, positioned at the branch it opened', () => {
		const simpsons = captured('simpsons');
		const focus = personByName(simpsons, 'Jessica Louise Lovejoy');
		const base = { ancestorDepth: 1, descendantDepth: 1 };
		const layout = layoutFocusView(simpsons, focus.id, base);
		const childStub = layout.stubs.find((s) => s.kind === 'children')!;
		const opened = layoutFocusView(simpsons, focus.id, { ...base, expandedStubIds: [childStub.id] });
		expect(opened.collapsers).toHaveLength(1);
		const union = opened.unions.find((u) => u.id === childStub.unionId)!;
		expect(opened.collapsers[0].x).toBeCloseTo(union.x);
		expect(opened.collapsers[0].y).toBeGreaterThan(union.y);
		expect(opened.people.length).toBeGreaterThan(layout.people.length);
	});

	it('ignores expansions for stubs that are not at a limit', () => {
		const simpsons = captured('simpsons');
		const focus = personByName(simpsons, 'Jessica Louise Lovejoy');
		const plain = layoutFocusView(simpsons, focus.id);
		const bogus = layoutFocusView(simpsons, focus.id, { expandedStubIds: ['stub:ancestors:nobody'] });
		expect(JSON.stringify(bogus)).toBe(JSON.stringify(plain));
	});
});

describe('step families', () => {
	const simpsons = captured('simpsons');

	for (const { name, graph } of allTestGraphs()) {
		it(`${name}: every person as focus honours the contract with step families on`, () => {
			for (const base of DEPTHS) {
				for (const focus of graph.people) {
					const layout = layoutFocusView(graph, focus.id, { ...base, shouldIncludeStepFamilies: true });
					expectClean(graph, layout, `${name} focus=${focus.displayName} ${JSON.stringify(base)}`);
				}
			}
		});
	}

	it("focus Bart: a stub for Jessica's children off, her children drawn on", () => {
		const bart = personByName(simpsons, 'Bartholomew Jojo Simpson');
		const jessica = personByName(simpsons, 'Jessica Louise Lovejoy');
		const off = layoutFocusView(simpsons, bart.id);
		expect(off.stubs.find((s) => s.personId === jessica.id)?.count).toBe(3);

		const on = layoutFocusView(simpsons, bart.id, { shouldIncludeStepFamilies: true });
		expect(on.stubs.filter((s) => s.personId === jessica.id)).toEqual([]);
		expectClean(simpsons, on, 'bart step on');
		const jessicaCard = on.people.find((p) => p.id === jessica.id)!;
		const children = on.edges.filter(
			(e): e is ChildEdge => e.kind === 'child' && e.assertions.some((a) => a.parentId === jessica.id)
		);
		expect(children.length).toBeGreaterThanOrEqual(3);
		for (const edge of children) expect(edge.target.y).toBeGreaterThan(jessicaCard.y);
	});

	it('an expanded "other families" stub draws the same family as the toggle, for that partner only', () => {
		const bart = personByName(simpsons, 'Bartholomew Jojo Simpson');
		const jessica = personByName(simpsons, 'Jessica Louise Lovejoy');
		const stubId = `stub:children:other:${jessica.id}`;
		const layout = layoutFocusView(simpsons, bart.id, { expandedStubIds: [stubId] });
		const toggled = layoutFocusView(simpsons, bart.id, { shouldIncludeStepFamilies: true });
		expect(layout.people.map((p) => p.id).sort()).toEqual(toggled.people.map((p) => p.id).sort());
		expect(layout.collapsers.map((c) => c.stubId)).toEqual([stubId]);
		expect(toggled.collapsers).toEqual([]);
	});
});

describe('relationship type filter', () => {
	const simpsons = captured('simpsons');

	it('keeps couples whole and drops only assertions of hidden types', () => {
		const graph: RelationshipGraph = structuredClone(simpsons);
		const link = graph.parentChild.find((pc) => pc.unionId)!;
		link.type = 'adoptive';
		for (const u of graph.unions) {
			for (const c of u.children) {
				if (c.childId === link.childId && c.parentId === link.parentId) c.type = 'adoptive';
			}
		}

		const filtered = filterParentChildTypes(graph, ['biological', 'unknown', 'foster', 'guardian']);
		expect(filtered.parentChild).toHaveLength(graph.parentChild.length - 1);
		expect(filtered.unions.map((u) => u.partnerIds)).toEqual(graph.unions.map((u) => u.partnerIds));
		for (const person of graph.people) {
			const layout = layoutFocusView(filtered, person.id);
			expect(allContractViolations(filtered, layout), person.displayName).toEqual([]);
		}
	});

	it('is the identity when every type is allowed', () => {
		const all = filterParentChildTypes(simpsons, ['biological', 'adoptive', 'foster', 'guardian', 'unknown']);
		expect(all.parentChild).toEqual(simpsons.parentChild);
	});
});
