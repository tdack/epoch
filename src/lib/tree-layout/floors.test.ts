import { describe, expect, it } from 'vitest';
import { layoutFloors, type FloorsLayout } from './floors';
import { buildIndex } from './graph-index';
import { selectFocusSubgraph } from './select';
import { allTestGraphs, makeGraph } from './test-support';
import { LAYOUT_METRICS, type FocusViewOptions } from './types';

const OPTIONS: FocusViewOptions[] = [
	{},
	{ ancestorDepth: 1, descendantDepth: 1 },
	{ ancestorDepth: 4, descendantDepth: 4, shouldIncludeStepFamilies: true },
	{ ancestorDepth: 2, descendantDepth: 2, shouldIncludeSiblings: false },
	{ collateralDepth: 2, shouldIncludePartnerOrigins: true }
];

const { cardWidth, stubWidth } = LAYOUT_METRICS;

/** Every (floor, band) row, with the left and right edge of each thing standing in it. */
function overlaps(layout: FloorsLayout): string[] {
	const rows = new Map<string, Array<{ id: string; left: number; right: number }>>();
	const add = (id: string, generation: number, band: number, x: number, width: number) => {
		const key = `${generation}/${band}`;
		const list = rows.get(key) ?? [];
		list.push({ id, left: x - width / 2, right: x + width / 2 });
		rows.set(key, list);
	};
	for (const p of layout.people) add(p.id, p.generation, p.band, p.x, cardWidth);
	for (const s of layout.stubs) add(s.id, s.generation, s.band, s.x, stubWidth);
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

describe('layoutFloors contract', () => {
	for (const { name, graph } of allTestGraphs()) {
		it(`${name}: every person as focus honours the floors contract`, () => {
			for (const options of OPTIONS) {
				for (const focus of graph.people) {
					const layout = layoutFloors(graph, focus.id, options);
					const label = `${name} focus ${focus.id} ${JSON.stringify(options)}`;
					const selection = selectFocusSubgraph(graph, focus.id, options, buildIndex(graph))!;

					expect(overlaps(layout), label).toEqual([]);

					// Everyone is placed exactly once, in the band selection gave them.
					const ids = layout.people.map((p) => p.id);
					expect(new Set(ids).size, label).toBe(ids.length);
					const expected = new Map(selection.people.map((p) => [p.id, p]));
					// The hourglass has no place for the wider groups yet, so they are appended to their
					// row; nobody on the line or in the narrow selection may be.
					const isWide = options.collateralDepth || options.shouldIncludePartnerOrigins;
					if (isWide) {
						for (const id of layout.misplacedPersonIds) {
							expect(expected.get(id)?.band, `${label}: misplaced ${id}`).toBeGreaterThan(0);
						}
					} else {
						expect(layout.misplacedPersonIds, label).toEqual([]);
					}
					for (const p of layout.people) {
						expect(p.band, `${label} band of ${p.id}`).toBe(expected.get(p.id)?.band);
						expect(p.generation, `${label} generation of ${p.id}`).toBe(
							expected.get(p.id)?.generation
						);
					}
					expect(
						ids.filter((id) => !expected.has(id)),
						label
					).toEqual([]);
					expect(layout.unions.map((u) => u.id).sort(), label).toEqual(
						selection.unions.map((u) => u.id).sort()
					);

					// Every drop leaves its union and lands on its child.
					const people = new Map(layout.people.map((p) => [p.id, p]));
					const unions = new Map(layout.unions.map((u) => [u.id, u]));
					for (const drop of layout.drops) {
						const child = people.get(drop.childId)!;
						expect(drop.lands, `${label} ${drop.id} lands`).toEqual({
							generation: child.generation,
							band: child.band,
							x: child.x
						});
						if (drop.unionId) {
							const union = unions.get(drop.unionId)!;
							expect(drop.leaves, `${label} ${drop.id} leaves`).toEqual({
								generation: union.generation,
								band: union.band,
								x: union.x
							});
						} else {
							expect(people.has(drop.parentId!), `${label} ${drop.id} parent`).toBe(true);
						}
						expect(drop.lands.generation, label).toBeGreaterThan(drop.leaves.generation);
					}

					// A union stands between its partners wherever they are on the floor.
					for (const u of layout.unions) {
						const xs = u.union.partnerIds.flatMap((id) => people.get(id)?.x ?? []);
						if (xs.length < 2) continue;
						expect(u.x, `${label} ${u.id}`).toBeGreaterThanOrEqual(Math.min(...xs) - 1e-6);
						expect(u.x, `${label} ${u.id}`).toBeLessThanOrEqual(Math.max(...xs) + 1e-6);
					}

					// Step-children sit in their anchor's band.
					for (const p of layout.people) {
						if (!p.isStepChild || !p.anchorParentId) continue;
						const anchor = people.get(p.anchorParentId);
						if (anchor) expect(p.band, `${label} step-child ${p.id}`).toBe(anchor.band);
					}
				}
			}
		});
	}

	it('is deterministic across runs', () => {
		for (const { graph } of allTestGraphs().slice(0, 4)) {
			const focus = graph.people[0].id;
			const options = { shouldIncludeStepFamilies: true };
			expect(layoutFloors(graph, focus, options)).toEqual(layoutFloors(graph, focus, options));
		}
	});
});

describe('layoutFloors rows', () => {
	// Selection reaches the focus's siblings, so on the focus's floor 'sib' sits on band 1 between
	// the focus and 'other' on band 0; band 0 closes the hole the sibling leaves.
	const graph = makeGraph({
		people: ['dad', 'mum', 'focus', 'sib', 'spouse', 'kid'],
		unions: [
			{ id: 'u1', partners: ['dad', 'mum'], children: ['sib', 'focus'] },
			{ id: 'u2', partners: ['focus', 'spouse'], children: ['kid'] }
		]
	});
	const at = (layout: FloorsLayout, id: string) => layout.people.find((p) => p.id === id)!;

	it('puts the sibling line on its own row of the focus floor', () => {
		const layout = layoutFloors(graph, 'focus');
		expect(at(layout, 'focus').band).toBe(0);
		expect(at(layout, 'spouse').band).toBe(0);
		expect(at(layout, 'sib').band).toBe(1);
		expect(at(layout, 'sib').generation).toBe(at(layout, 'focus').generation);
		expect(layout.floors.find((f) => f.generation === 0)?.bands).toEqual([0, 1]);
	});

	it('closes the gap the other band left in a row', () => {
		const layout = layoutFloors(graph, 'focus');
		const focus = at(layout, 'focus');
		const spouse = at(layout, 'spouse');
		expect(Math.abs(spouse.x - focus.x)).toBeLessThanOrEqual(
			cardWidth + LAYOUT_METRICS.partnerGap + 1e-6
		);
		expect(overlaps(layout)).toEqual([]);
	});

	it('returns an empty layout for an unknown focus', () => {
		expect(layoutFloors(graph, 'nobody').people).toEqual([]);
		expect(layoutFloors(graph, null).floors).toEqual([]);
	});
});
