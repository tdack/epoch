import { describe, expect, it } from 'vitest';
import type { RelationshipGraphPerson } from '#lib/tree-layout/types.js';
import { hoverCard, type ShellPerson } from './webgl-tree.js';

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
		expect(hoverCard(mum.person, people, 'ancestor')).toEqual({
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
