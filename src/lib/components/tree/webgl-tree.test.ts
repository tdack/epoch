import { describe, expect, it } from 'vitest';
import type { RelationshipGraphPerson } from '#lib/tree-layout/types.js';
import { computeHighlight, linkKey } from '#lib/tree-layout/highlight.js';
import { layoutRings } from '#lib/tree-layout/rings.js';
import { makeGraph } from '#lib/tree-layout/test-support.js';
import {
	describeMark,
	highlightRoles,
	hoverCard,
	sourceLabel,
	type ShellPerson
} from './webgl-tree.js';

function person(
	id: string,
	parents: string[] = [],
	extra: Partial<RelationshipGraphPerson> = {}
): ShellPerson {
	return {
		id,
		generation: 0,
		person: {
			id,
			displayName: `Person ${id}`,
			sex: null,
			isDeceased: false,
			parentsByUnion: parents.length
				? { u1: parents.map((parentId) => ({ parentId, type: 'biological' as const })) }
				: {},
			unionIds: [],
			stepParents: [],
			...extra
		}
	};
}

describe('hoverCard', () => {
	it('counts the children in view and the partnerships, and names the role', () => {
		const mum = person('mum', [], { sex: 'F', unionIds: ['u1', 'u2'] });
		const people = [mum, person('a', ['mum', 'dad']), person('b', ['mum']), person('c', ['dad'])];
		expect(hoverCard(mum.person, people, 'Ancestor')).toEqual({
			name: 'Person mum',
			sex: 'Female',
			roleLabel: 'Ancestor',
			partnershipCount: 2,
			childrenInView: 2
		});
	});

	it('says nothing about a role off the focus line, and Unknown for an unrecorded sex', () => {
		const card = hoverCard(person('x').person, [person('x')], null);
		expect(card.roleLabel).toBeNull();
		expect(card.sex).toBe('Unknown');
		expect(card.childrenInView).toBe(0);
	});
});

describe('describing a highlight', () => {
	const graph = makeGraph({
		people: ['G1', 'G2', 'A', 'B', 'K'],
		unions: [
			{ id: 'ug', partners: ['G1', 'G2'], children: ['A', 'B'] },
			{ id: 'ua', partners: ['A'], children: ['K'] }
		]
	});
	const kin = layoutRings(graph, 'A', { ancestorDepth: 4, descendantDepth: 4 });
	const label = (source: { kind: string }) =>
		'personId' in source ? String(source.personId) : 'it';

	it('says the focus line in the words it always used', () => {
		const h = computeHighlight(kin, [{ kind: 'focus', personId: 'A' }]);
		expect(describeMark(h.people.get('A')!, h, label)).toBe('Focus person');
		expect(describeMark(h.people.get('G1')!, h, label)).toBe('Ancestor');
		expect(describeMark(h.people.get('K')!, h, label)).toBe('Descendant');
		expect([...highlightRoles(h)]).toEqual(
			expect.arrayContaining([
				['A', 'focus'],
				['G1', 'ancestor'],
				['K', 'descendant']
			])
		);
	});

	it('names the traced source, and counts the traced paths a shared item is on', () => {
		const h = computeHighlight(
			kin,
			[
				{ kind: 'person', personId: 'A' },
				{ kind: 'person', personId: 'B' }
			],
			true
		);
		expect(describeMark(h.people.get('K')!, h, label)).toBe('Descendant of A, traced');
		expect(describeMark(h.people.get('G1')!, h, label)).toBe('On 2 traced paths');
	});

	it('lights the partners of a selected partnership without making either the focus', () => {
		const h = computeHighlight(kin, [{ kind: 'union', unionId: 'ug', shouldSplitPartners: true }]);
		expect(highlightRoles(h).get('G1')).toBe('partner');
		expect(describeMark(h.people.get('G1')!, h, label)).toBe('Selected');
	});
});

describe('sourceLabel', () => {
	const graph = makeGraph({
		people: ['Ann', 'Ben', 'Cat', 'Hidden'],
		unions: [
			{ id: 'u', partners: ['Ann', 'Ben'], children: ['Cat'] },
			{ id: 'p', partners: ['Hidden'] }
		]
	});
	graph.people.find((p) => p.id === 'Hidden')!.isPrivate = true;
	const kin = layoutRings(graph, 'Ann', { descendantDepth: 3 });

	it('names a person, a partnership by its partners and a line by its child', () => {
		expect(sourceLabel(kin, { kind: 'person', personId: 'Ann' })).toBe('Ann');
		expect(sourceLabel(kin, { kind: 'union', unionId: 'u', shouldSplitPartners: true })).toBe(
			'the partnership of Ann and Ben'
		);
		const link = kin.childLinks.find((l) => l.childId === 'Cat')!;
		expect(sourceLabel(kin, { kind: 'link', key: linkKey(link) })).toBe('the line to Cat');
	});

	it('never names a private person', () => {
		expect(sourceLabel(kin, { kind: 'person', personId: 'Hidden' })).toBe('a private person');
	});
});
