import { describe, expect, it } from 'vitest';
import { layoutDescendants, layoutPedigree, CARD } from '../../charts/chart-layout';
import { buildDescendants, buildPedigree } from './descent-charts';
import { treeRows } from '../testing/rows';

// Heap order of a 3-generation pedigree: me, father, mother, paternal grandfather and grandmother, maternal ...
const rows = treeRows({
	people: [
		{ id: 'me' }, { id: 'dad', sex: 'M' }, { id: 'mum', sex: 'F' }, { id: 'gpa', sex: 'M' }, { id: 'gma', sex: 'F' }, { id: 'sib' }, { id: 'kid' }, { id: 'adopter', sex: 'F' }
	],
	links: [
		{ parentId: 'mum', childId: 'me' }, { parentId: 'dad', childId: 'me' }, { parentId: 'gma', childId: 'dad' }, { parentId: 'gpa', childId: 'dad' },
		{ parentId: 'dad', childId: 'sib' }, { parentId: 'me', childId: 'kid' }, { parentId: 'adopter', childId: 'me', type: 'adoptive' }
	]
} as never);
const context = { rows, placeholderIds: new Set<string>() };
const names = (slots: Array<{ name: string } | null>) => slots.map((s) => s?.name ?? null);

describe('the pedigree', () => {
	it('puts the person first and each person\'s parents at 2i+1 and 2i+2, father before mother', () => {
		const dto = buildPedigree(context, 'me', 3)!;
		expect(names(dto.slots)).toEqual(['me', 'dad', 'mum', 'gpa', 'gma', null, null]);
		expect(dto.hasMoreAbove).toBe(false);
	});
	it('prefers biological parents when there are more than two', () => {
		expect(names(buildPedigree(context, 'me', 2)!.slots)).toEqual(['me', 'dad', 'mum']);
	});
	it('says when there are more ancestors above the last generation drawn', () => {
		expect(buildPedigree(context, 'me', 2)!.hasMoreAbove).toBe(true);
	});
	it('puts a lone mother in the second slot', () => {
		const only = treeRows({ people: [{ id: 'c' }, { id: 'm', sex: 'F' }], links: [{ parentId: 'm', childId: 'c' }] } as never);
		expect(names(buildPedigree({ rows: only, placeholderIds: new Set() }, 'c', 2)!.slots)).toEqual(['c', null, 'm']);
	});
	it('is absent for a person who is not in the rows, and shows a placeholder as Private with nothing else', () => {
		expect(buildPedigree(context, 'nobody', 3)).toBeNull();
		const shown = buildPedigree({ rows, placeholderIds: new Set(['dad']) }, 'me', 2)!;
		expect(shown.slots[1]).toMatchObject({ id: 'dad', isPrivate: true, name: 'Private', birth: null, death: null });
	});
});

describe('the descendants', () => {
	it('lists children below their parent, to the depth asked, and says when more lie beyond', () => {
		const down = buildDescendants(context, 'dad', 3)!;
		expect(down.root.children.map((c) => c.person.name).sort()).toEqual(['me', 'sib']);
		expect(down.root.children.find((c) => c.person.name === 'me')!.children.map((c) => c.person.name)).toEqual(['kid']);
		expect(down.hasMoreBelow).toBe(false);
		expect(buildDescendants(context, 'dad', 2)!.hasMoreBelow).toBe(true);
	});
	it('is absent for an unknown person', () => {
		expect(buildDescendants(context, 'nobody', 3)).toBeNull();
	});
});

describe('layout', () => {
	it('puts each pedigree generation in its own column and centres a person between their parents', () => {
		const layout = layoutPedigree(buildPedigree(context, 'me', 3)!.slots, 3);
		const at = (key: string) => layout.cards.find((c) => c.key === key)!;
		expect(at('s0').x).toBe(0);
		expect(at('s1').x).toBe(CARD.width + CARD.columnGap);
		expect(at('s3').x).toBe(2 * (CARD.width + CARD.columnGap));
		expect(at('s1').y).toBeCloseTo((at('s3').y + at('s4').y) / 2);
		expect(at('s0').y).toBeCloseTo((at('s1').y + at('s2').y) / 2);
		// Mum has no recorded parents, so her slot's two children are empty and draw no edge.
		expect(layout.edges.filter((e) => e.from === 's2')).toEqual([]);
		expect(layout.height).toBeGreaterThan(0);
	});
	it('gives descendant leaves their own rows and centres a parent on its children', () => {
		const layout = layoutDescendants(buildDescendants(context, 'dad', 3)!.root);
		const by = (name: string) => layout.cards.find((c) => c.person.name === name)!;
		expect(by('dad').x).toBe(0);
		expect(by('kid').x).toBe(2 * (CARD.width + CARD.columnGap));
		expect(new Set(layout.cards.filter((c) => c.person.name !== 'dad' && c.person.name !== 'me').map((c) => c.y)).size).toBe(2);
		expect(by('me').y).toBe(by('kid').y);
		expect(layout.edges).toHaveLength(3);
	});
});
