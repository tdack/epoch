import { describe, expect, it } from 'vitest';
import { HIGHLIGHT_TOKENS } from '#lib/components/tree/tree-tokens.js';
import { resolvePalette } from '#lib/components/tree/palette.js';
import {
	computeHighlight,
	linkKey,
	MAX_TRACE_ITEMS,
	QUIET_HIGHLIGHT,
	sourceKey,
	toggleTraceItem,
	type HighlightSource,
	type KinSource
} from './highlight.js';
import { layoutRings, ringLineage } from './rings.js';
import { allTestGraphs, makeGraph } from './test-support.js';

const WIDE = { ancestorDepth: 6, descendantDepth: 6, collateralDepth: 2 } as const;

/** Grandparents G1+G2 have A and B; A+SA have Kid1; B+SB have Kid2; the cousins have C. */
const FAMILY = makeGraph({
	people: ['G1', 'G2', 'A', 'B', 'SA', 'SB', 'K1', 'K2', 'C', 'Loner'],
	unions: [
		{ id: 'ug', partners: ['G1', 'G2'], children: ['A', 'B'] },
		{ id: 'ua', partners: ['A', 'SA'], children: ['K1'] },
		{ id: 'ub', partners: ['B', 'SB'], children: ['K2'] },
		{ id: 'uc', partners: ['K1', 'K2'], children: ['C'] }
	]
});
const kinOf = (graph = FAMILY, focus = 'C'): KinSource => layoutRings(graph, focus, WIDE);
const nameOf = (graph: typeof FAMILY, id: string) => graph.people.find((p) => p.id === id)!.id;

describe("the focus source reproduces today's focus line", () => {
	for (const { name, graph } of allTestGraphs()) {
		it(`on ${name}`, () => {
			for (const person of graph.people.slice(0, 12)) {
				const layout = layoutRings(graph, person.id, WIDE);
				if (layout.people.length === 0) continue;
				const highlight = computeHighlight(layout, [{ kind: 'focus', personId: person.id }]);
				const lineage = ringLineage(layout, person.id);
				const expected = new Map<string, string>();
				for (const id of lineage.partnerIds) expected.set(id, 'partner');
				for (const id of lineage.descendantIds) expected.set(id, 'descendant');
				for (const id of lineage.ancestorIds) expected.set(id, 'ancestor');
				expected.set(person.id, 'self');
				const roles = new Map([...highlight.people].map(([id, m]) => [id, m.kind]));
				expect(roles).toEqual(expected);
				// Everything on the focus line is full strength, and partners keep the partner colour.
				for (const mark of highlight.people.values()) expect(mark.strength).toBe('full');

				// The scenes' own rule for a lit line and a lit partnership.
				const isOnLine = (id: string) =>
					['self', 'ancestor', 'descendant'].includes(roles.get(id) ?? '');
				for (const union of layout.unions)
					expect(highlight.unions.has(union.id)).toBe(union.partnerIds.some(isOnLine));
				for (const link of layout.childLinks) {
					const childRole = roles.get(link.childId);
					const isLit =
						(childRole === 'descendant' && link.parentIds.some(isOnLine)) ||
						((childRole === 'self' || childRole === 'ancestor') &&
							link.parentIds.some((id) => roles.get(id) === 'ancestor'));
					expect(highlight.links.has(linkKey(link))).toBe(isLit);
				}
			}
		});
	}

	it('colours the line with the focus colours', () => {
		const h = computeHighlight(kinOf(), [{ kind: 'focus', personId: 'A' }]);
		expect(h.people.get('G1')!.colour).toBe(HIGHLIGHT_TOKENS.focus.ancestor);
		expect(h.people.get('K1')!.colour).toBe(HIGHLIGHT_TOKENS.focus.descendant);
		expect(h.people.get('SA')!.colour).toBe(HIGHLIGHT_TOKENS.focus.partner);
		expect(h.isQuiet).toBe(false);
	});
});

describe('a partnership', () => {
	const split: HighlightSource = { kind: 'union', unionId: 'uc', shouldSplitPartners: true };

	it('gives each partner their own colour, never a sex colour, and the descendants theirs', () => {
		const h = computeHighlight(kinOf(), [split]);
		expect(h.people.get('A')!.colour).not.toBe(h.people.get('B')!.colour);
		expect(h.people.get('C')!.colour).toBe(HIGHLIGHT_TOKENS.descendant);
		expect(h.people.get('C')!.kind).toBe('descendant');
		expect(h.unions.get('uc')!.kind).toBe('self');
		expect(HIGHLIGHT_TOKENS.trace).toContain(h.people.get('K1')!.colour);
		expect(HIGHLIGHT_TOKENS.trace).toContain(h.people.get('K2')!.colour);
	});

	it('marks the grandparents both cousins share as an intersection', () => {
		const h = computeHighlight(kinOf(), [split]);
		expect(h.people.get('G1')!.isShared).toBe(true);
		expect(h.people.get('G1')!.colour).toBe(HIGHLIGHT_TOKENS.intersection);
		expect(h.people.get('A')!.isShared).toBe(false);
	});

	it('takes one colour when not split', () => {
		const h = computeHighlight(kinOf(), [{ ...split, shouldSplitPartners: false }]);
		expect(h.people.get('A')!.colour).toBe(h.people.get('B')!.colour);
		expect(h.people.get('G1')!.isShared).toBe(false);
	});

	it("does not light the children of a partner's other partnership", () => {
		const h = computeHighlight(kinOf(), [
			{ kind: 'union', unionId: 'ua', shouldSplitPartners: true }
		]);
		expect(h.people.has('K1')).toBe(true);
		expect(h.people.has('C')).toBe(true);
		expect(h.people.has('K2')).toBe(false);
	});
});

describe('a parent-child line', () => {
	const kin = kinOf();
	const key = linkKey(kin.childLinks.find((l) => l.childId === 'K1')!);

	it('marks its own partnership once, as upstream, so it is not shared with itself', () => {
		const h = computeHighlight(kin, [{ kind: 'link', key }]);
		const union = kin.childLinks.find((l) => l.childId === 'K1')!.fromUnionId!;
		expect(h.unions.get(union)).toMatchObject({
			kind: 'ancestor',
			strength: 'soft',
			isShared: false
		});
	});

	it('is full downstream and soft upstream', () => {
		const h = computeHighlight(kin, [{ kind: 'link', key }]);
		expect(h.links.get(key)).toMatchObject({ kind: 'self', strength: 'full' });
		for (const id of ['K1', 'C'])
			expect(h.people.get(id)).toMatchObject({ kind: 'descendant', strength: 'full' });
		for (const id of ['A', 'SA', 'G1', 'G2'])
			expect(h.people.get(id)).toMatchObject({ kind: 'ancestor', strength: 'soft' });
		expect(h.people.has('B')).toBe(false);
		expect(h.people.has('K2')).toBe(false);
	});
});

describe('trace mode', () => {
	const kin = kinOf();
	const person = (personId: string): HighlightSource => ({ kind: 'person', personId });

	it('gives each item its own colour', () => {
		const h = computeHighlight(kin, [person('A'), person('SB')], true);
		expect(h.isTrace).toBe(true);
		expect(h.sources.map((s) => s.colour)).toEqual([...HIGHLIGHT_TOKENS.trace.slice(0, 2)]);
		expect(h.people.get('A')!.colour).toBe(HIGHLIGHT_TOKENS.trace[0]);
		expect(h.people.get('SB')!.colour).toBe(HIGHLIGHT_TOKENS.trace[1]);
	});

	it('marks where paths meet as shared, with the intersection colour', () => {
		const h = computeHighlight(kin, [person('A'), person('B')], true);
		// Both are children of G1+G2, and both reach C through their children.
		for (const id of ['G1', 'G2', 'C']) {
			expect(h.people.get(id)!.isShared).toBe(true);
			expect(h.people.get(id)!.colour).toBe(HIGHLIGHT_TOKENS.intersection);
			expect(h.people.get(id)!.sourceIndexes).toEqual([0, 1]);
		}
		expect(h.people.get('K1')!.isShared).toBe(false);
		expect(h.unions.get('ug')!.isShared).toBe(true);
	});

	it('is soft upstream and full downstream for each item', () => {
		const h = computeHighlight(kin, [person('A')], true);
		expect(h.people.get('G1')!.strength).toBe('soft');
		expect(h.people.get('K1')!.strength).toBe('full');
		expect(h.people.get('A')!.strength).toBe('full');
	});

	it('is quiet with nothing traced or a source the layout does not draw', () => {
		expect(computeHighlight(kin, [], true).isQuiet).toBe(true);
		expect(computeHighlight(kin, [person('nobody')], true).isQuiet).toBe(true);
		expect(QUIET_HIGHLIGHT.isQuiet).toBe(true);
	});

	it('holds at six items and says so on a seventh', () => {
		let items: HighlightSource[] = [];
		for (let i = 0; i < MAX_TRACE_ITEMS; i++) {
			const change = toggleTraceItem(items, person(`p${i}`));
			expect(change.result).toBe('added');
			items = change.items;
		}
		const seventh = toggleTraceItem(items, person('p7'));
		expect(seventh.result).toBe('full');
		expect(seventh.items).toHaveLength(MAX_TRACE_ITEMS);
		expect(toggleTraceItem(items, person('p0')).result).toBe('removed');
		// The model itself also refuses a seventh, whatever the caller passes.
		const many = Array.from({ length: 9 }, (_, i) => person(i % 2 ? 'A' : 'B'));
		expect(computeHighlight(kin, many, true).sources.length).toBeLessThanOrEqual(MAX_TRACE_ITEMS);
		expect(sourceKey({ kind: 'focus', personId: 'A' })).toBe(sourceKey(person('A')));
	});
});

describe('private people', () => {
	// A private placeholder stands between the grandparents and their grandchild.
	const graph = makeGraph({
		people: ['Old', 'Hidden', 'Kid', 'Other'],
		unions: [
			{ id: 'u1', partners: ['Old'], children: ['Hidden'] },
			{ id: 'u2', partners: ['Hidden'], children: ['Kid'] }
		]
	});
	graph.people.find((p) => p.id === 'Hidden')!.isPrivate = true;
	const kin = layoutRings(graph, 'Kid', WIDE);

	it('are never marked and stop a walk', () => {
		const up = computeHighlight(kin, [{ kind: 'focus', personId: 'Kid' }]);
		expect(up.people.has('Hidden')).toBe(false);
		expect(up.people.has('Old')).toBe(false);
		const down = computeHighlight(kin, [{ kind: 'person', personId: 'Old' }], true);
		expect(down.people.has('Hidden')).toBe(false);
		expect(down.people.has('Kid')).toBe(false);
	});

	it('light nothing as a source', () => {
		expect(computeHighlight(kin, [{ kind: 'person', personId: 'Hidden' }], true).isQuiet).toBe(
			true
		);
	});
});

describe('bad data', () => {
	it('survives a parent loop without hanging', () => {
		const graph = makeGraph({
			people: ['A', 'B'],
			direct: [
				{ parentId: 'A', childId: 'B' },
				{ parentId: 'B', childId: 'A' }
			]
		});
		const kin = layoutRings(graph, 'A', WIDE);
		const h = computeHighlight(kin, [{ kind: 'person', personId: 'A' }], true);
		expect(nameOf(graph, 'B')).toBe('B');
		expect(h.people.size).toBeGreaterThan(0);
	});
});

describe('computeHighlight with a chosen palette', () => {
	it('paints the focus line in the palette colours, not the built-in ones', () => {
		const palette = resolvePalette({ focusColours: { ancestor: '#101010' } });
		const h = computeHighlight(kinOf(), [{ kind: 'focus', personId: 'A' }], false, palette);
		expect(h.people.get('G1')!.colour).toBe('#101010');
		expect(h.people.get('K1')!.colour).toBe(HIGHLIGHT_TOKENS.focus.descendant);
	});

	it('paints a trace with the palette trace slots', () => {
		const palette = resolvePalette({ tracePalette: { trace: ['#111111', '#222222'] } });
		const person = (personId: string): HighlightSource => ({ kind: 'person', personId });
		const h = computeHighlight(kinOf(), [person('A'), person('SB')], true, palette);
		expect(h.people.get('A')!.colour).toBe('#111111');
		expect(h.people.get('SB')!.colour).toBe('#222222');
	});
});
