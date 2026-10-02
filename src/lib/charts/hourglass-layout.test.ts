import { describe, expect, it } from 'vitest';
import { CARD, layoutHourglass } from './chart-layout';
import type { ChartPerson, DescendantNode } from '../shared/charts';

const p = (id: string): ChartPerson => ({ id, name: id, isPrivate: false, birth: null, death: null });
const node = (id: string, children: DescendantNode[] = []): DescendantNode => ({ person: p(id), partners: [], children });

// Me, with two parents and one grandparent above, two children and a grandchild below.
const slots = [p('me'), p('dad'), p('mum'), p('gpa'), null, null, null];
const root = node('me', [node('kid1', [node('grandkid')]), node('kid2')]);

describe('the hourglass layout', () => {
	const layout = layoutHourglass(slots, 3, root);
	const at = (id: string) => layout.cards.find((c) => c.person.id === id)!;

	it('draws the person once, with ancestors to one side and descendants to the other', () => {
		expect(layout.cards.filter((c) => c.person.id === 'me')).toHaveLength(1);
		expect(at('dad').x).toBeGreaterThan(at('me').x);
		expect(at('gpa').x).toBeGreaterThan(at('dad').x);
		expect(at('kid1').x).toBeLessThan(at('me').x);
		expect(at('grandkid').x).toBeLessThan(at('kid1').x);
	});

	it('keeps every card on the canvas, with columns a card and a gap apart', () => {
		for (const c of layout.cards) {
			expect(c.x).toBeGreaterThanOrEqual(0);
			expect(c.y).toBeGreaterThanOrEqual(0);
			expect(c.x + CARD.width).toBeLessThanOrEqual(layout.width);
			expect(c.y + CARD.height).toBeLessThanOrEqual(layout.height);
		}
		expect(at('me').x - at('kid1').x).toBe(CARD.width + CARD.columnGap);
		expect(at('dad').x - at('me').x).toBe(CARD.width + CARD.columnGap);
	});

	it('joins every card to the person through its edges, the person standing in for the first slot', () => {
		const keyOf = (id: string) => at(id).key;
		const has = (from: string, to: string) => layout.edges.some((e) => e.from === keyOf(from) && e.to === keyOf(to));
		expect(has('me', 'dad')).toBe(true);
		expect(has('me', 'mum')).toBe(true);
		expect(has('dad', 'gpa')).toBe(true);
		expect(has('me', 'kid1')).toBe(true);
		expect(has('kid1', 'grandkid')).toBe(true);
		const keys = new Set(layout.cards.map((c) => c.key));
		for (const e of layout.edges) expect(keys.has(e.from) && keys.has(e.to)).toBe(true);
	});

	it('centres the person between their parents and between their children', () => {
		const middle = (a: string, b: string) => (at(a).y + at(b).y) / 2;
		expect(at('me').y).toBeCloseTo(middle('dad', 'mum'));
		expect(at('me').y).toBeCloseTo(middle('kid1', 'kid2'));
	});

	it('is the descendants chart mirrored when nobody is recorded above', () => {
		const alone = layoutHourglass([p('me'), null, null], 2, root);
		expect(alone.cards).toHaveLength(4);
		expect(alone.cards.find((c) => c.person.id === 'me')!.x).toBe(Math.max(...alone.cards.map((c) => c.x)));
	});
});
