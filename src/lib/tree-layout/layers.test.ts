import { describe, expect, it } from 'vitest';
import { buildIndex } from './graph-index';
import { layoutLayers, LAYER_SIDES, type LayersLayout } from './layers';
import { selectFocusSubgraph } from './select';
import { allTestGraphs, makeGraph } from './test-support';
import { LAYOUT_METRICS, type FocusViewOptions } from './types';

const OPTIONS: FocusViewOptions[] = [
	{},
	{ ancestorDepth: 1, descendantDepth: 1 },
	{ ancestorDepth: 4, descendantDepth: 4, shouldIncludeStepFamilies: true },
	{ collateralDepth: 2, shouldIncludePartnerOrigins: true },
	{ ancestorDepth: 4, collateralDepth: 1, shouldIncludePartnerOrigins: true }
];
const SIDE_RANK = { first: 0, centre: 1, second: 2 };
const { cardWidth, stubWidth } = LAYOUT_METRICS;

/** Everything standing in a plane's rows, as left and right edges. */
function overlaps(layout: LayersLayout): string[] {
	const rows = new Map<string, Array<{ id: string; left: number; right: number }>>();
	const add = (id: string, plane: number, generation: number, x: number, width: number) => {
		const key = `${plane}/${generation}`;
		rows.set(key, [...(rows.get(key) ?? []), { id, left: x - width / 2, right: x + width / 2 }]);
	};
	for (const p of layout.people) add(p.id, p.plane, p.generation, p.x, cardWidth);
	for (const g of layout.ghosts) add(g.id, g.plane, g.generation, g.x, cardWidth);
	for (const s of layout.stubs) add(s.id, s.plane, s.generation, s.x, stubWidth);
	const found: string[] = [];
	for (const [key, list] of rows) {
		list.sort((a, b) => a.left - b.left);
		for (let i = 1; i < list.length; i++) {
			if (list[i].left < list[i - 1].right - 1e-6) {
				found.push(`${list[i - 1].id} overlaps ${list[i].id} on ${key}`);
			}
		}
	}
	return found;
}

describe('layoutLayers contract', () => {
	for (const { name, graph } of allTestGraphs()) {
		it(`${name}: every person as focus honours the layers contract`, () => {
			for (const options of OPTIONS) {
				for (const focus of graph.people) {
					const layout = layoutLayers(graph, focus.id, null, options);
					const label = `${name} focus ${focus.id} ${JSON.stringify(options)}`;
					const selection = selectFocusSubgraph(graph, focus.id, options, buildIndex(graph))!;

					expect(overlaps(layout), label).toEqual([]);

					// Everyone is placed exactly once, in the row selection gave them.
					const ids = layout.people.map((p) => p.id);
					expect(new Set(ids).size, label).toBe(ids.length);
					const expected = new Map(selection.people.map((p) => [p.id, p]));
					expect(
						ids.filter((id) => !expected.has(id)),
						label
					).toEqual([]);
					expect(
						[...expected.keys()].filter((id) => !ids.includes(id)),
						label
					).toEqual([]);
					for (const p of layout.people) {
						expect(p.generation, `${label} generation of ${p.id}`).toBe(
							expected.get(p.id)?.generation
						);
						expect(p.band, `${label} band of ${p.id}`).toBe(expected.get(p.id)?.band);
						// The plane is the band, except that the focus person's ancestors stand one plane back.
						const isMoved = p.role === 'ancestor' && p.band === 0;
						if (!isMoved && p.role !== 'partner') expect(p.plane, `${label} ${p.id}`).toBe(p.band);
						if (isMoved) expect(p.plane, `${label} ${p.id}`).toBe(1);
					}
					expect(layout.unions.map((u) => u.id).sort(), label).toEqual(
						selection.unions.map((u) => u.id).sort()
					);
					expect(layout.stubs.map((s) => s.id).sort(), label).toEqual(
						selection.stubs.map((s) => s.id).sort()
					);

					// Each side stays on its side: no row has someone of the first side to the right of the second.
					const rows = new Map<string, Array<{ x: number; rank: number; id: string }>>();
					for (const c of [...layout.people, ...layout.ghosts]) {
						const key = `${c.plane}/${c.generation}`;
						const id = 'personId' in c ? c.personId : c.id;
						rows.set(key, [...(rows.get(key) ?? []), { x: c.x, rank: SIDE_RANK[c.side], id }]);
					}
					for (const [key, row] of rows) {
						row.sort((a, b) => a.x - b.x);
						for (let i = 1; i < row.length; i++) {
							expect(
								row[i].rank,
								`${label} ${key}: ${row[i - 1].id} before ${row[i].id}`
							).toBeGreaterThanOrEqual(row[i - 1].rank);
						}
					}

					// A depth link joins a placeholder to the card of the same person on another plane.
					const people = new Map(layout.people.map((p) => [p.id, p]));
					const ghosts = new Map(layout.ghosts.map((g) => [g.id, g]));
					expect(layout.depthLinks.length, label).toBe(layout.ghosts.length);
					for (const link of layout.depthLinks) {
						const ghost = ghosts.get(link.id.replace('depth:', 'ghost:'))!;
						const real = people.get(link.personId)!;
						expect(ghost.personId, `${label} ${link.id}`).toBe(link.personId);
						expect(ghost.person.id, label).toBe(real.person.id);
						expect(link.from).toEqual({
							plane: ghost.plane,
							generation: ghost.generation,
							x: ghost.x
						});
						expect(link.to).toEqual({ plane: real.plane, generation: real.generation, x: real.x });
						expect(ghost.plane, label).not.toBe(real.plane);
						expect(ghost.generation, label).toBe(real.generation);
					}

					// A plane draws edges only between things standing on it.
					const standingOn = (plane: number) =>
						new Set([
							...layout.people
								.filter((p) => p.plane === plane)
								.map((p) => `${p.x}|${p.generation}`),
							...layout.ghosts.filter((g) => g.plane === plane).map((g) => `${g.x}|${g.generation}`)
						]);
					for (const edge of layout.edges) {
						if (edge.kind !== 'child') continue;
						const on = standingOn(edge.plane);
						expect(
							on.has(`${edge.target.x}|${edge.target.y / LAYOUT_METRICS.rowHeight}`),
							`${label} ${edge.id} lands on a card of plane ${edge.plane}`
						).toBe(true);
					}

					// A union stands between its partners wherever they are on the plane.
					for (const u of layout.unions) {
						const xs = u.union.partnerIds.flatMap((id) =>
							people.get(id)?.plane === u.plane ? [people.get(id)!.x] : []
						);
						if (xs.length < 2) continue;
						expect(u.x, `${label} ${u.id}`).toBeGreaterThanOrEqual(Math.min(...xs) - 1e-6);
						expect(u.x, `${label} ${u.id}`).toBeLessThanOrEqual(Math.max(...xs) + 1e-6);
					}

					// Step-children stand on their anchor's plane.
					for (const p of layout.people) {
						if (!p.isStepChild || !p.anchorParentId) continue;
						const anchor = people.get(p.anchorParentId);
						if (anchor && anchor.role !== 'ancestor') {
							expect(p.plane, `${label} step-child ${p.id}`).toBe(anchor.plane);
						}
					}
				}
			}
		});
	}

	it('is deterministic across runs', () => {
		for (const { graph } of allTestGraphs().slice(0, 4)) {
			const focus = graph.people[0].id;
			const options = { collateralDepth: 2, shouldIncludePartnerOrigins: true };
			expect(layoutLayers(graph, focus, null, options)).toEqual(
				layoutLayers(graph, focus, null, options)
			);
		}
	});
});

/** Two grandparent pairs, the focus union's two sets of parents, a sibling each, and a child. */
const family = (firstSex: 'M' | 'F', secondSex: 'M' | 'F') =>
	makeGraph({
		people: [
			{ id: 'first', sex: firstSex },
			{ id: 'second', sex: secondSex },
			'first-dad',
			'first-mum',
			'second-dad',
			'second-mum',
			'first-sib',
			'second-sib',
			'kid'
		],
		unions: [
			{ id: 'u-focus', partners: ['first', 'second'], children: ['kid'] },
			{ id: 'u-first', partners: ['first-dad', 'first-mum'], children: ['first', 'first-sib'] },
			{ id: 'u-second', partners: ['second-dad', 'second-mum'], children: ['second', 'second-sib'] }
		]
	});
const WIDE: FocusViewOptions = { collateralDepth: 2, shouldIncludePartnerOrigins: true };
const at = (layout: LayersLayout, id: string) => layout.people.find((p) => p.id === id)!;

describe('layoutLayers planes', () => {
	const layout = layoutLayers(family('M', 'F'), 'first', null, WIDE);

	it('puts the union and its children on plane 0 and the families it came from on plane 1', () => {
		expect(layout.focusUnionId).toBe('u-focus');
		for (const id of ['first', 'second', 'kid']) expect(at(layout, id).plane, id).toBe(0);
		for (const id of ['first-dad', 'first-mum', 'second-dad', 'second-mum', 'first-sib'])
			expect(at(layout, id).plane, id).toBe(1);
		// The partner's sibling is a cousin-line person of the focus, so it stands one plane further back.
		expect(at(layout, 'second-sib').plane).toBe(2);
	});

	it('shows the child of the union under its parents on the plane they stand on', () => {
		const ghosts = layout.ghosts.map((g) => `${g.personId}@${g.plane}`).sort();
		expect(ghosts).toContain('first@1');
		expect(ghosts).toContain('second@1');
		expect(ghosts).not.toContain('kid@0');
	});
});

describe('layoutLayers sides', () => {
	// Whose side someone is on is the union_partner order, never sex: the same family with the
	// partners' sexes swapped must put the first partner's relatives on the left either way.
	for (const [firstSex, secondSex] of [
		['M', 'F'],
		['F', 'M'],
		['M', 'M'],
		['F', 'F']
	] as const) {
		it(`puts the first partner left of the second (${firstSex} and ${secondSex})`, () => {
			const layout = layoutLayers(family(firstSex, secondSex), 'first', null, WIDE);
			expect(at(layout, 'first').x).toBeLessThan(at(layout, 'second').x);
			expect(at(layout, 'first-dad').x).toBeLessThan(at(layout, 'second-dad').x);
			expect(at(layout, 'first-mum').x).toBeLessThan(at(layout, 'second-mum').x);
			for (const id of ['first-dad', 'first-mum', 'first-sib'])
				expect(at(layout, id).side, id).toBe(LAYER_SIDES.FIRST);
			for (const id of ['second-dad', 'second-mum', 'second-sib'])
				expect(at(layout, id).side, id).toBe(LAYER_SIDES.SECOND);
			expect(at(layout, 'kid').side).toBe(LAYER_SIDES.CENTRE);
		});
	}

	it('follows the focus person: refocusing on the second partner keeps the order', () => {
		const layout = layoutLayers(family('M', 'F'), 'second', null, WIDE);
		expect(at(layout, 'first').x).toBeLessThan(at(layout, 'second').x);
		expect(at(layout, 'first-dad').x).toBeLessThan(at(layout, 'second-dad').x);
	});

	it('orders partners by union_partner order, so listing them the other way swaps them', () => {
		const graph = family('M', 'F');
		const swapped = {
			...graph,
			unions: graph.unions.map((u) =>
				u.id === 'u-focus' ? { ...u, partnerIds: [...u.partnerIds].reverse() } : u
			)
		};
		const layout = layoutLayers(swapped, 'first', null, WIDE);
		expect(at(layout, 'second').x).toBeLessThan(at(layout, 'first').x);
		expect(at(layout, 'second-dad').x).toBeLessThan(at(layout, 'first-dad').x);
	});
});

describe('layoutLayers union', () => {
	const graph = makeGraph({
		people: ['me', 'ex', 'now', 'ex-kid', 'now-kid'],
		unions: [
			{ id: 'u-ex', partners: ['me', 'ex'], marriageDate: '1990', children: ['ex-kid'] },
			{ id: 'u-now', partners: ['me', 'now'], marriageDate: '2000', children: ['now-kid'] }
		]
	});

	it('centres on the first union by default and offers every one', () => {
		const layout = layoutLayers(graph, 'me', null);
		expect(layout.focusUnionId).toBe('u-ex');
		expect(layout.unionChoices.map((u) => [u.id, u.label])).toEqual([
			['u-ex', 'ex'],
			['u-now', 'now']
		]);
	});

	it('takes the union asked for, and falls back when it is not one of the focus person’s', () => {
		expect(layoutLayers(graph, 'me', 'u-now').focusUnionId).toBe('u-now');
		expect(layoutLayers(graph, 'me', 'nonsense').focusUnionId).toBe('u-ex');
		expect(layoutLayers(graph, 'ex-kid', 'u-now').focusUnionId).toBeNull();
	});

	it('draws a person with no union on plane 0 alone, and one side only', () => {
		const lone = makeGraph({
			people: ['lone', 'dad', 'mum'],
			unions: [{ id: 'u', partners: ['dad', 'mum'], children: ['lone'] }]
		});
		const layout = layoutLayers(lone, 'lone', null);
		expect(layout.focusUnionId).toBeNull();
		expect(layout.people.filter((p) => p.plane === 0).map((p) => p.id)).toEqual(['lone']);
		expect(new Set(layout.people.map((p) => p.side))).toEqual(new Set([LAYER_SIDES.FIRST]));
	});

	it('returns an empty layout for an unknown focus', () => {
		expect(layoutLayers(graph, 'nobody', null).people).toEqual([]);
		expect(layoutLayers(graph, null, null).planes).toEqual([]);
	});
});
