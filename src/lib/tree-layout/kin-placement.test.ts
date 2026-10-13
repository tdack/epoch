import { describe, expect, it } from 'vitest';
import { buildIndex } from './graph-index';
import { assignBands, stepChildAnchor, type KinInput } from './kin-placement';
import { selectFocusSubgraph } from './select';
import { CAPTURED_GRAPHS, makeGraph, personByName } from './test-support';
import type { Band, FocusViewOptions, RelationshipGraph } from './types';

/** Everything in the graph drawn, so bands can be checked on shapes the selection does not reach yet. */
function everyoneDrawn(graph: RelationshipGraph, focusPersonId: string): KinInput {
	return {
		focusPersonId,
		people: graph.people.map((p) => ({ id: p.id })),
		unions: graph.unions.map((u) => ({ id: u.id }))
	};
}

function bandsOf(graph: RelationshipGraph, focusPersonId: string): Record<string, Band> {
	const { bands } = assignBands(everyoneDrawn(graph, focusPersonId), buildIndex(graph));
	return Object.fromEntries([...bands].sort(([a], [b]) => (a < b ? -1 : 1)));
}

function selectedBands(
	graph: RelationshipGraph,
	focusName: string,
	options?: FocusViewOptions
): Record<string, Band> {
	const selection = selectFocusSubgraph(graph, personByName(graph, focusName).id, options)!;
	const nameOf = new Map(graph.people.map((p) => [p.id, p.displayName]));
	return Object.fromEntries(selection.people.map((p) => [nameOf.get(p.id)!, p.band]));
}

const simpsons = CAPTURED_GRAPHS.find((g) => g.name === 'simpsons')!.graph;

/** Grandparents, the focus's parents, an uncle with a cousin line, and the focus's sibling. */
const extended = makeGraph({
	people: ['G1', 'G2', 'P', 'PS', 'Uncle', 'UW', 'Focus', 'Sib', 'Cousin', 'CW', 'CKid', 'FP'],
	unions: [
		{ id: 'ug', partners: ['G1', 'G2'], children: ['P', 'Uncle'] },
		{ id: 'up', partners: ['P', 'PS'], children: ['Focus', 'Sib'] },
		{ id: 'uu', partners: ['Uncle', 'UW'], children: ['Cousin'] },
		{ id: 'uc', partners: ['Cousin', 'CW'], children: ['CKid'] },
		{ id: 'uf', partners: ['Focus', 'FP'] }
	]
});

describe('assignBands', () => {
	it('puts the Simpsons direct line in band 0 and only the siblings in band 1', () => {
		expect(selectedBands(simpsons, 'Jessica Lovejoy')).toEqual({
			'Timothy Lovejoy': 0,
			'Helen Lovejoy': 0,
			'Bartholomew Jo-Jo Simpson': 0,
			'Jessica Lovejoy': 0,
			'Sherri Lovejoy': 1,
			'Todd Jackson Lovejoy': 0,
			'Rodney James Lovejoy': 0,
			'Maude Helen Lovejoy': 0,
			'Selma Bouvier': 0,
			'Ralph Lovejoy': 0,
			'Nelson Lovejoy': 0
		});
	});

	it('moves the sibling line with the focus person', () => {
		const sherri = selectedBands(simpsons, 'Sherri Lovejoy');
		expect(sherri['Sherri Lovejoy']).toBe(0);
		expect(sherri['Jessica Lovejoy']).toBe(1);
		const maude = selectedBands(simpsons, 'Maude Helen Lovejoy');
		expect(maude['Maude Helen Lovejoy']).toBe(0);
		expect(Object.values(maude).every((b) => b === 0 || b === 1)).toBe(true);
	});

	it('bands every drawn person for every focus on every captured graph', () => {
		for (const { name, graph } of CAPTURED_GRAPHS) {
			for (const focus of graph.people) {
				const selection = selectFocusSubgraph(graph, focus.id)!;
				for (const person of selection.people) {
					expect([0, 1, 2], `${name} ${focus.displayName}`).toContain(person.band);
				}
				expect(selection.people.find((p) => p.id === focus.id)!.band).toBe(0);
			}
		}
	});

	it('bands the line, its siblings, and their descendants', () => {
		expect(bandsOf(extended, 'Focus')).toEqual({
			CKid: 2,
			CW: 2,
			Cousin: 2,
			FP: 0,
			Focus: 0,
			G1: 0,
			G2: 0,
			P: 0,
			PS: 0,
			Sib: 1,
			Uncle: 1,
			UW: 1
		});
	});

	it('keeps band 2 as the furthest band', () => {
		expect(bandsOf(extended, 'Focus').CKid).toBe(2);
	});

	it('gives a partner the band of the person they partner', () => {
		const bands = bandsOf(extended, 'Focus');
		expect(bands.FP).toBe(bands.Focus);
		expect(bands.UW).toBe(bands.Uncle);
		expect(bands.CW).toBe(bands.Cousin);
	});

	it('gives a person reachable at two bands the lower one', () => {
		// X is a nephew of the focus person (band 2) and also the focus person's partner (band 0).
		const graph = makeGraph({
			people: ['G1', 'G2', 'Focus', 'Sib', 'SibP', 'X'],
			unions: [
				{ id: 'ug', partners: ['G1', 'G2'], children: ['Focus', 'Sib'] },
				{ id: 'us', partners: ['Sib', 'SibP'], children: ['X'] },
				{ id: 'uf', partners: ['Focus', 'X'] }
			]
		});
		const bands = bandsOf(graph, 'Focus');
		expect(bands.X).toBe(0);
		expect(bands.Sib).toBe(1);
	});

	it('does not depend on the order people, unions or links arrive in', () => {
		const forward = bandsOf(extended, 'Focus');
		const shuffled: RelationshipGraph = {
			people: [...extended.people].reverse(),
			unions: [...extended.unions].reverse(),
			parentChild: [...extended.parentChild].reverse()
		};
		expect(bandsOf(shuffled, 'Focus')).toEqual(forward);
	});
});

describe('step-children', () => {
	/** F and P are a couple; P also has K1 with F, and S with Q in an earlier union. */
	function household(partners: [string, string] = ['P', 'Q']) {
		return makeGraph({
			people: ['F', 'P', 'Q', 'K1', 'S'],
			unions: [
				{ id: 'u1', partners: ['F', 'P'], children: ['K1'] },
				{ id: 'u2', partners, children: ['S'] }
			]
		});
	}

	it('marks a household partner’s child from another union as a step-child anchored to that partner', () => {
		const graph = household();
		const selection = selectFocusSubgraph(graph, 'F', { shouldIncludeStepFamilies: true })!;
		const s = selection.people.find((p) => p.id === 'S')!;
		const k1 = selection.people.find((p) => p.id === 'K1')!;
		expect(s).toMatchObject({ isStepChild: true, band: 0 });
		expect(k1).toMatchObject({ isStepChild: false, anchorParentId: expect.any(String) });
		// Both of S's parents are drawn and band 0, so the earlier partner in the union wins.
		expect(s.anchorParentId).toBe('P');
	});

	it('breaks a tie between two drawn parents by union_partner order, not by sex or id', () => {
		const graph = household(['Q', 'P']);
		const selection = selectFocusSubgraph(graph, 'F', { shouldIncludeStepFamilies: true })!;
		expect(selection.people.find((p) => p.id === 'S')!.anchorParentId).toBe('Q');
	});

	it('breaks a tie between direct-link parents by the lower id', () => {
		const graph = makeGraph({
			people: ['F', 'P', 'Z', 'A', 'S'],
			unions: [{ id: 'u1', partners: ['F', 'P'] }],
			direct: [
				{ parentId: 'Z', childId: 'S' },
				{ parentId: 'A', childId: 'S' },
				{ parentId: 'P', childId: 'S' }
			]
		});
		const index = buildIndex(graph);
		const people = ['F', 'P', 'Z', 'A', 'S'].map((id) => ({ id }));
		const bands = assignBands({ focusPersonId: 'F', people, unions: [{ id: 'u1' }] }, index).bands;
		// P, Z and A are all drawn; Z and A are not partners of anyone so they fall to band 0 by default.
		expect(stepChildAnchor('S', { people }, index, bands)).toBe('A');
	});

	it('prefers the parent drawn on the lower band when the two parents sit on different bands', () => {
		// S has direct links to the focus person’s sibling (band 1) and the focus person’s partner
		// (band 0); with no union between them the sibling is not pulled down to band 0.
		const graph = makeGraph({
			people: ['G1', 'G2', 'Focus', 'Sib', 'FP', 'S', 'Nephew'],
			unions: [
				{ id: 'ug', partners: ['G1', 'G2'], children: ['Focus', 'Sib'] },
				{ id: 'uf', partners: ['Focus', 'FP'] }
			],
			direct: [
				{ parentId: 'Sib', childId: 'S' },
				{ parentId: 'FP', childId: 'S' },
				{ parentId: 'Sib', childId: 'Nephew' }
			]
		});
		const index = buildIndex(graph);
		const input = everyoneDrawn(graph, 'Focus');
		const { bands, stepChildIds } = assignBands(input, index);
		expect(bands.get('Sib')).toBe(1);
		expect(bands.get('FP')).toBe(0);
		expect(stepChildAnchor('S', input, index, bands)).toBe('FP');
		// The lower of its two bands, because it is also a step-child of the focus person’s partner.
		expect(bands.get('S')).toBe(0);
		expect(stepChildIds.has('S')).toBe(true);
		expect(bands.get('Nephew')).toBe(2);
		expect(stepChildIds.has('Nephew')).toBe(false);
	});

	it('does not call a couple’s shared child in the sibling line a step-child of the in-law', () => {
		const { bands, stepChildIds } = assignBands(
			everyoneDrawn(extended, 'Focus'),
			buildIndex(extended)
		);
		expect(bands.get('Cousin')).toBe(2);
		expect(stepChildIds.size).toBe(0);
	});

	it('anchors a child with only an adoptive parent drawn to that parent', () => {
		const graph = makeGraph({
			people: ['F', 'P', 'Q', 'S'],
			unions: [
				{ id: 'u1', partners: ['F', 'P'] },
				{ id: 'u2', partners: ['P', 'Q'], children: [{ id: 'S', type: 'adoptive' }] }
			]
		});
		const selection = selectFocusSubgraph(graph, 'F', { shouldIncludeStepFamilies: true })!;
		const s = selection.people.find((p) => p.id === 'S')!;
		expect(s).toMatchObject({ isStepChild: true, anchorParentId: 'P' });
	});

	it('uses a drawn adoptive parent when the biological parent is not drawn', () => {
		const graph = makeGraph({
			people: ['F', 'P', 'Bio', 'S'],
			unions: [{ id: 'u1', partners: ['F', 'P'] }],
			direct: [
				{ parentId: 'Bio', childId: 'S' },
				{ parentId: 'P', childId: 'S', type: 'adoptive' }
			]
		});
		const index = buildIndex(graph);
		const people = ['F', 'P', 'S'].map((id) => ({ id }));
		const bands = assignBands({ focusPersonId: 'F', people, unions: [{ id: 'u1' }] }, index).bands;
		expect(stepChildAnchor('S', { people }, index, bands)).toBe('P');
	});

	it('prefers a drawn biological parent over a drawn adoptive one', () => {
		const graph = makeGraph({
			people: ['F', 'P', 'Bio', 'S'],
			unions: [{ id: 'u1', partners: ['F', 'P'] }],
			direct: [
				{ parentId: 'Bio', childId: 'S' },
				{ parentId: 'P', childId: 'S', type: 'adoptive' }
			]
		});
		const index = buildIndex(graph);
		const people = ['F', 'P', 'Bio', 'S'].map((id) => ({ id }));
		const bands = assignBands({ focusPersonId: 'F', people, unions: [{ id: 'u1' }] }, index).bands;
		expect(stepChildAnchor('S', { people }, index, bands)).toBe('Bio');
	});

	it('draws no card for a step-child whose parents are not drawn, and counts them in a stub', () => {
		const graph = household();
		const selection = selectFocusSubgraph(graph, 'F')!;
		expect(selection.people.map((p) => p.id)).not.toContain('S');
		expect(selection.stubs).toContainEqual(
			expect.objectContaining({ id: 'stub:children:other:P', count: 1 })
		);
		// Were P and Q not cards, S would have no anchor.
		const people = selection.people.filter((p) => p.id !== 'P' && p.id !== 'Q');
		const index = buildIndex(graph);
		const bands = assignBands(selection, index).bands;
		expect(stepChildAnchor('S', { people }, index, bands)).toBeNull();
	});

	it('gives an ordinary child the earlier partner of their one union as anchor', () => {
		const graph = household();
		const selection = selectFocusSubgraph(graph, 'F')!;
		expect(selection.people.find((p) => p.id === 'K1')).toMatchObject({
			anchorParentId: 'F',
			isStepChild: false
		});
	});

	it('is deterministic across runs and input orders', () => {
		const options = { shouldIncludeStepFamilies: true };
		const run = (graph: RelationshipGraph) =>
			selectFocusSubgraph(graph, 'F', options)!
				.people.map((p) => [p.id, p.band, p.anchorParentId, p.isStepChild] as const)
				.sort(([a], [b]) => (a < b ? -1 : 1));
		const graph = household();
		const first = run(graph);
		expect(run(graph)).toEqual(first);
		expect(
			run({
				people: [...graph.people].reverse(),
				unions: [...graph.unions].reverse(),
				parentChild: [...graph.parentChild].reverse()
			})
		).toEqual(first);
	});
});
