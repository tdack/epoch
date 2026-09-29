import { describe, it, expect } from 'vitest';
import { buildIndex } from './graph-index';
import { selectFocusSubgraph } from './select';
import { allTestGraphs, CAPTURED_GRAPHS, personByName, SYNTHETIC_GRAPHS } from './test-support';
import { PERSON_ROLES, type FocusViewOptions, type RelationshipGraph } from './types';

const DEPTHS: FocusViewOptions[] = [
	{ ancestorDepth: 0, descendantDepth: 0 },
	{ ancestorDepth: 1, descendantDepth: 1 },
	{ ancestorDepth: 2, descendantDepth: 1 },
	{ ancestorDepth: 1, descendantDepth: 3 },
	{ ancestorDepth: 3, descendantDepth: 3 },
	{ ancestorDepth: 8, descendantDepth: 8 }
].flatMap((d) => [
	{ ...d, includeSiblings: true },
	{ ...d, includeSiblings: false }
]);

function select(graph: RelationshipGraph, focusId: string, options: FocusViewOptions) {
	const selection = selectFocusSubgraph(graph, focusId, options);
	if (!selection) throw new Error(`no selection for ${focusId}`);
	return selection;
}

function names(graph: RelationshipGraph, ids: string[]): string[] {
	return ids.map((id) => graph.people.find((p) => p.id === id)!.displayName);
}

describe('selectFocusSubgraph contract sweeps', () => {
	for (const { name, graph } of allTestGraphs()) {
		describe(name, () => {
			const index = buildIndex(graph);

			it('draws every partner of every drawn union, and the completeness rules hold', () => {
				for (const options of DEPTHS) {
					for (const focus of graph.people) {
						const s = select(graph, focus.id, options);
						const ctx = `${name} focus=${focus.displayName} ${JSON.stringify(options)}`;
						const drawn = new Map(s.people.map((p) => [p.id, p]));
						const drawnUnions = new Set(s.unions.map((u) => u.id));
						const { ancestorDepth, descendantDepth, includeSiblings } = s.options;

						expect(drawn.size, `${ctx}: unique people`).toBe(s.people.length);
						expect(drawn.get(focus.id)?.generation, ctx).toBe(0);

						// Rule 1: no drawn union is missing a partner.
						for (const u of s.unions) {
							for (const partnerId of index.unionById.get(u.id)!.partnerIds) {
								expect(drawn.has(partnerId), `${ctx}: partner ${partnerId} of ${u.id}`).toBe(true);
							}
						}

						// Completeness: nothing is dropped unless a depth limit hides it behind a stub.
						const stubFor = (id: string) => s.stubs.find((st) => st.id === id);
						for (const p of s.people) {
							if (p.generation > descendantDepth || p.generation < -ancestorDepth) {
								throw new Error(`${ctx}: ${p.id} is outside the depth limits`);
							}
							const isDescendantSide = p.role === PERSON_ROLES.FOCUS || p.role === PERSON_ROLES.DESCENDANT;
							if (isDescendantSide) {
								for (const union of index.unionsOfPerson.get(p.id) ?? []) {
									expect(drawnUnions.has(union.id), `${ctx}: ${p.id} union ${union.id}`).toBe(true);
									const children = index.childIdsOfUnion.get(union.id) ?? [];
									const hidden = children.filter((c) => !drawn.has(c));
									if (p.generation < descendantDepth) {
										expect(hidden, `${ctx}: children of ${union.id}`).toEqual([]);
									} else {
										expect(stubFor(`stub:children:${union.id}`)?.count ?? 0, ctx).toBe(hidden.length);
									}
								}
							}
							const isAncestorSide = isDescendantSide || p.role === PERSON_ROLES.ANCESTOR;
							if (isAncestorSide) {
								const parentUnions = index.parentUnionIdsOfChild.get(p.id) ?? [];
								if (p.generation > -ancestorDepth) {
									for (const unionId of parentUnions) {
										// Descendants' parents are the union they came from; only the focus line climbs.
										if (p.role === PERSON_ROLES.DESCENDANT) continue;
										expect(drawnUnions.has(unionId), `${ctx}: parents of ${p.id}`).toBe(true);
									}
								}
							}
						}
						if (includeSiblings && ancestorDepth > 0) {
							for (const unionId of index.parentUnionIdsOfChild.get(focus.id) ?? []) {
								for (const siblingId of index.childIdsOfUnion.get(unionId) ?? []) {
									expect(drawn.has(siblingId), `${ctx}: sibling ${siblingId}`).toBe(true);
								}
							}
						}
						if (!includeSiblings) {
							expect(s.people.some((p) => p.role === PERSON_ROLES.SIBLING), ctx).toBe(false);
						}
					}
				}
			});

			it('is deterministic', () => {
				for (const focus of graph.people) {
					const a = select(graph, focus.id, { ancestorDepth: 2, descendantDepth: 2 });
					const b = select(graph, focus.id, { ancestorDepth: 2, descendantDepth: 2 });
					expect(b).toEqual(a);
				}
			});

			it('returns null for an unknown focus', () => {
				expect(selectFocusSubgraph(graph, 'nobody')).toBeNull();
			});
		});
	}
});

describe('known layout bugs', () => {
	const simpsons = CAPTURED_GRAPHS.find((g) => g.name === 'simpsons')!.graph;
	const peopleOf = (focus: string, options?: FocusViewOptions) =>
		names(simpsons, select(simpsons, personByName(simpsons, focus).id, options ?? {}).people.map((p) => p.id));

	it('focusing Jessica Lovejoy includes Rosalind Fairfax, Ned Lovejoy\'s partner', () => {
		expect(peopleOf('Jessica Louise Lovejoy')).toContain('Rosalind Fairfax');
		expect(peopleOf('Jessica Louise Lovejoy')).toContain('Ned Dermot Lovejoy');
	});

	it('focusing Homer Simpson or Marjorie Bouvier includes Maude Flanders', () => {
		expect(peopleOf('Homer Jay Simpson')).toContain('Maude Flanders');
		expect(peopleOf('Marjorie Jacqueline Bouvier')).toContain('Maude Flanders');
	});

	it('keeps the partner at the depth boundary and stubs only the couple\'s children', () => {
		const jessica = personByName(simpsons, 'Jessica Louise Lovejoy');
		const s = select(simpsons, jessica.id, { descendantDepth: 1 });
		expect(names(simpsons, s.people.map((p) => p.id))).toContain('Rosalind Fairfax');
		const stub = s.stubs.find((st) => st.kind === 'children' && st.personId === personByName(simpsons, 'Ned Dermot Lovejoy').id);
		expect(stub?.count).toBe(2);
		expect(names(simpsons, s.people.map((p) => p.id))).not.toContain('Magnus Lovejoy');

		const homer = personByName(simpsons, 'Homer Jay Simpson');
		const t = select(simpsons, homer.id, { descendantDepth: 1 });
		expect(names(simpsons, t.people.map((p) => p.id))).toContain('Maude Flanders');
		expect(t.stubs.find((st) => st.kind === 'children')?.count).toBe(2);
	});

	it('stubs a partner\'s undrawn family instead of dropping it (focus Bart, Jessica\'s children)', () => {
		const bart = personByName(simpsons, 'Bartholomew Jojo Simpson');
		const s = select(simpsons, bart.id, {});
		const jessica = personByName(simpsons, 'Jessica Louise Lovejoy');
		expect(s.stubs.find((st) => st.personId === jessica.id)?.count).toBe(3);
		expect(s.people.find((p) => p.id === jessica.id)?.role).toBe(PERSON_ROLES.PARTNER);
	});

	it('includes siblings only when asked', () => {
		const bart = personByName(simpsons, 'Bartholomew Jojo Simpson');
		expect(peopleOf('Bartholomew Jojo Simpson', { includeSiblings: true })).toContain('Lenora Marie Simpson');
		expect(peopleOf('Bartholomew Jojo Simpson', { includeSiblings: false })).not.toContain('Lenora Marie Simpson');
		expect(select(simpsons, bart.id, {}).people.find((p) => p.id === bart.id)?.role).toBe(PERSON_ROLES.FOCUS);
	});
});

describe('pedigree collapse and shared parents', () => {
	const synthetic = (name: string) => SYNTHETIC_GRAPHS.find((g) => g.name === name)!.graph;

	it('draws shared grandparents once and records the collapse', () => {
		const graph = synthetic('cousin-marriage');
		const s = select(graph, 'C', { ancestorDepth: 4 });
		const ids = s.people.map((p) => p.id);
		expect(ids.filter((id) => id === 'G1')).toHaveLength(1);
		expect(s.unions.filter((u) => u.id === 'ug')).toHaveLength(1);
		expect(s.collapsedPersonIds).toEqual(expect.arrayContaining(['G1', 'G2']));
	});

	it('draws a child of two unions once when focusing the shared parent', () => {
		const graph = CAPTURED_GRAPHS.find((g) => g.name === 'representative-551')!.graph;
		const alice = personByName(graph, 'Alice /Walker/');
		const s = select(graph, alice.id, {});
		const david = personByName(graph, 'David /Smith/');
		expect(s.people.filter((p) => p.id === david.id)).toHaveLength(1);
		expect(s.unions).toHaveLength(2);
		expect(s.collapsedPersonIds).toContain(david.id);
	});

	it('draws a shared parent once when focusing the child of two unions', () => {
		const graph = CAPTURED_GRAPHS.find((g) => g.name === 'representative-551')!.graph;
		const david = personByName(graph, 'David /Smith/');
		const s = select(graph, david.id, {});
		const alice = personByName(graph, 'Alice /Walker/');
		expect(s.people.filter((p) => p.id === alice.id)).toHaveLength(1);
		expect(s.unions).toHaveLength(2);
		expect(names(graph, s.people.map((p) => p.id))).toEqual(
			expect.arrayContaining(['Bob /Smith/', 'Carol /Jones/', 'Emily /Foster-Child/'])
		);
	});

	it('walks direct links with no union', () => {
		const s = select(synthetic('direct-links-only'), 'Kid1', {});
		expect(s.people.map((p) => [p.id, p.generation])).toEqual(
			expect.arrayContaining([['Parent', -1], ['Grand', -2]])
		);
		const down = select(synthetic('direct-links-only'), 'Parent', { descendantDepth: 0 });
		expect(down.stubs.find((st) => st.unionId === null)?.count).toBe(2);
	});

	it('draws a person\'s three unions with all their partners', () => {
		const s = select(synthetic('three-unions'), 'Pat', {});
		expect(s.unions).toHaveLength(3);
		expect(s.people.map((p) => p.id)).toEqual(expect.arrayContaining(['Q1', 'Q2', 'Q3', 'K1', 'K2', 'K3']));
	});
});
