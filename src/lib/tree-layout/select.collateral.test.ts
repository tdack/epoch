import { describe, expect, it } from 'vitest';
import { buildIndex } from './graph-index';
import { selectFocusSubgraph } from './select';
import { allTestGraphs, makeGraph } from './test-support';
import { PERSON_ROLES, type FocusViewOptions, type RelationshipGraph } from './types';

/**
 * Two grandparents with two children: the focus's parent and an aunt, who has a partner, a child
 * (the cousin) and that child's partner and baby. The focus has a sibling and a partner whose own
 * parents (and sibling) are the origins.
 */
const FAMILY: RelationshipGraph = makeGraph({
	people: [
		'grandpa',
		'grandma',
		'parent',
		'parent-partner',
		'aunt',
		'aunt-partner',
		'cousin',
		'cousin-partner',
		'cousin-baby',
		'focus',
		'sibling',
		'spouse',
		'spouse-father',
		'spouse-mother',
		'spouse-sister',
		'spouse-grandparent'
	],
	unions: [
		{ id: 'u-grand', partners: ['grandpa', 'grandma'], children: ['parent', 'aunt'] },
		{ id: 'u-parent', partners: ['parent', 'parent-partner'], children: ['focus', 'sibling'] },
		{ id: 'u-aunt', partners: ['aunt', 'aunt-partner'], children: ['cousin'] },
		{ id: 'u-cousin', partners: ['cousin', 'cousin-partner'], children: ['cousin-baby'] },
		{ id: 'u-focus', partners: ['focus', 'spouse'] },
		{
			id: 'u-origin',
			partners: ['spouse-father', 'spouse-mother'],
			children: ['spouse', 'spouse-sister']
		},
		{ id: 'u-origin-up', partners: ['spouse-grandparent'], children: ['spouse-father'] }
	]
});

function pick(options: FocusViewOptions) {
	const selection = selectFocusSubgraph(FAMILY, 'focus', { ancestorDepth: 1, ...options })!;
	const byId = new Map(selection.people.map((p) => [p.id, p]));
	return { selection, byId, has: (id: string) => byId.has(id) };
}

describe('collateralDepth', () => {
	it('draws neither aunts nor the focus siblings partners by default', () => {
		const { has, byId } = pick({ ancestorDepth: 2 });
		expect(has('aunt')).toBe(false);
		expect(has('cousin')).toBe(false);
		expect(byId.get('sibling')?.band).toBe(1);
	});

	it('1 draws the aunt and her partner, and counts the cousin in a stub', () => {
		const { byId, selection } = pick({ ancestorDepth: 2, collateralDepth: 1 });
		expect(byId.get('aunt')).toMatchObject({ band: 1, generation: -1, role: PERSON_ROLES.SIBLING });
		expect(byId.get('aunt-partner')).toMatchObject({ band: 1, role: PERSON_ROLES.PARTNER });
		expect(byId.has('cousin')).toBe(false);
		expect(selection.stubs.find((s) => s.id === 'stub:children:u-aunt')).toMatchObject({
			count: 1,
			personId: 'aunt',
			generation: 0
		});
	});

	it('2 draws the cousin and their partner on band 2, and counts the baby', () => {
		const { byId, selection } = pick({ ancestorDepth: 2, collateralDepth: 2 });
		expect(byId.get('cousin')).toMatchObject({ band: 2, generation: 0 });
		expect(byId.get('cousin-partner')?.band).toBe(2);
		expect(byId.has('cousin-baby')).toBe(false);
		expect(selection.stubs.find((s) => s.id === 'stub:children:u-cousin')?.count).toBe(1);
		// The focus's own sibling, drawn since the hourglass began, is on the same band as the aunt.
		expect(byId.get('sibling')?.band).toBe(1);
	});

	it('opening a stub shows one more generation, and offers a way to close it', () => {
		const { byId, selection } = pick({
			ancestorDepth: 2,
			collateralDepth: 1,
			expandedStubIds: ['stub:children:u-aunt']
		});
		expect(byId.get('cousin')?.band).toBe(2);
		expect(selection.expansions.map((e) => e.stubId)).toContain('stub:children:u-aunt');
		expect(selection.stubs.map((s) => s.id)).not.toContain('stub:children:u-aunt');
	});

	it('cannot reach the aunts of a topmost ancestor, whose parents are not drawn', () => {
		const { has } = pick({ ancestorDepth: 1, collateralDepth: 2 });
		// Depth 1 draws the parents only, so their siblings (the aunt) have no drawn union to come from.
		expect(has('parent')).toBe(true);
		expect(has('aunt')).toBe(false);
	});

	it('clamps to two', () => {
		const wide = pick({ ancestorDepth: 2, collateralDepth: 9 });
		expect(wide.selection.options.collateralDepth).toBe(2);
	});
});

describe('shouldIncludePartnerOrigins', () => {
	it('is off by default', () => {
		expect(pick({}).has('spouse-father')).toBe(false);
	});

	it("draws the partner's parents on band 1 and their sibling on band 2", () => {
		const { byId, selection } = pick({ shouldIncludePartnerOrigins: true });
		expect(byId.get('spouse-father')).toMatchObject({
			band: 1,
			generation: -1,
			role: PERSON_ROLES.ANCESTOR
		});
		expect(byId.get('spouse-mother')?.band).toBe(1);
		expect(byId.get('spouse-sister')).toMatchObject({ band: 2, generation: 0 });
		expect(selection.unions.map((u) => u.id)).toContain('u-origin');
	});

	it("stops one row up, with a stub for the origin parents' own parents", () => {
		const { has, selection } = pick({ shouldIncludePartnerOrigins: true, ancestorDepth: 3 });
		expect(has('spouse-grandparent')).toBe(false);
		expect(selection.stubs.find((s) => s.id === 'stub:ancestors:spouse-father')).toMatchObject({
			count: 1,
			generation: -2
		});
	});

	it('opens that stub one generation at a time', () => {
		const { has, selection } = pick({
			shouldIncludePartnerOrigins: true,
			expandedStubIds: ['stub:ancestors:spouse-father']
		});
		expect(has('spouse-grandparent')).toBe(true);
		expect(selection.expansions.map((e) => e.stubId)).toContain('stub:ancestors:spouse-father');
	});

	it("does not draw the origins of anyone but the focus person's partners", () => {
		const selection = selectFocusSubgraph(FAMILY, 'parent', {
			shouldIncludePartnerOrigins: true
		})!;
		// The focus's partner is parent-partner, whose parents are not in this graph; and the spouse of
		// the focus's child is not a partner of the focus.
		expect(selection.people.map((p) => p.id)).not.toContain('spouse-father');
	});
});

/** The graphs the layout suites use, with every focus: the wider selection only ever adds. */
describe('a wider selection over the fixtures', () => {
	const WIDE: FocusViewOptions = { collateralDepth: 2, shouldIncludePartnerOrigins: true };
	const NARROW_AND_WIDE: FocusViewOptions[] = [
		{},
		{ ancestorDepth: 1, descendantDepth: 1 },
		{ ancestorDepth: 4, descendantDepth: 2, shouldIncludeStepFamilies: true }
	];

	for (const { name, graph } of allTestGraphs()) {
		it(`${name}: never loses a person, always banded, partners drawn with their union`, () => {
			const index = buildIndex(graph);
			let hasBandTwo = false;
			for (const options of NARROW_AND_WIDE) {
				for (const focus of graph.people) {
					const ctx = `${name} focus ${focus.id} ${JSON.stringify(options)}`;
					const narrow = selectFocusSubgraph(graph, focus.id, options, index)!;
					const wide = selectFocusSubgraph(graph, focus.id, { ...options, ...WIDE }, index)!;

					const wideIds = new Set(wide.people.map((p) => p.id));
					expect(wideIds.size, `${ctx}: unique`).toBe(wide.people.length);
					for (const p of narrow.people)
						expect(wideIds.has(p.id), `${ctx}: lost ${p.id}`).toBe(true);
					const wideUnions = new Set(wide.unions.map((u) => u.id));
					for (const u of narrow.unions)
						expect(wideUnions.has(u.id), `${ctx}: lost ${u.id}`).toBe(true);

					for (const u of wide.unions) {
						for (const partnerId of index.unionById.get(u.id)!.partnerIds) {
							expect(wideIds.has(partnerId), `${ctx}: ${partnerId} missing from ${u.id}`).toBe(
								true
							);
						}
					}
					for (const p of wide.people) {
						expect([0, 1, 2], `${ctx}: ${p.id} band`).toContain(p.band);
						if (p.band === 2) hasBandTwo = true;
					}
					// A stub never counts someone who is drawn.
					for (const s of wide.stubs) expect(s.count, `${ctx}: ${s.id}`).toBeGreaterThan(0);
				}
			}
			// The fixtures that have cousins at all must show them, or the sweep proves nothing.
			if (name === 'simpsons') expect(hasBandTwo).toBe(true);
		});
	}
});
