import { describe, it, expect } from 'vitest';
import { planRelationshipCommand } from './relationship-commands';
import type { ParentChild } from './genealogy-model';

const alex = { id: 'p-alex', givenName: 'Alex', surname: 'Walker' };
const sam = { id: 'p-sam', givenName: 'Sam', surname: 'Smith' };

function assertion(overrides: Partial<ParentChild> & { parentId: string; childId: string }): ParentChild {
	return {
		id: crypto.randomUUID(),
		treeId: 'tree-1',
		type: 'biological',
		status: 'active',
		unionId: null,
		version: 1,
		createdAt: new Date(),
		updatedAt: new Date(),
		...overrides
	};
}

const noContext = { assertions: [], hasDuplicateName: false, unionCount: 0 };

describe('planRelationshipCommand', () => {
	it('plans an add_parent as an assert_parent_child command', () => {
		const plan = planRelationshipCommand(
			{ kind: 'add_parent', child: sam, parent: alex, type: 'adoptive', role: 'mother', unionLabel: null },
			noContext
		);
		expect(plan.commands).toHaveLength(1);
		expect(plan.commands[0]).toMatchObject({
			kind: 'assert_parent_child',
			parentId: 'p-alex',
			childId: 'p-sam',
			type: 'adoptive'
		});
		expect(plan.sentence).toContain('adoptive mother');
	});

	it('plans an add_partner as a create_union command', () => {
		const plan = planRelationshipCommand(
			{ kind: 'add_partner', person: alex, partner: sam, unionLabel: null },
			noContext
		);
		expect(plan.commands[0]).toMatchObject({ kind: 'create_union', personIds: ['p-alex', 'p-sam'] });
	});

	it('flags a duplicate-name warning', () => {
		const plan = planRelationshipCommand(
			{ kind: 'add_parent', child: sam, parent: alex, type: 'biological', role: 'parent', unionLabel: null },
			{ assertions: [], hasDuplicateName: true, unionCount: 0 }
		);
		expect(plan.warnings.some((w) => w.code === 'DUPLICATE_PERSON')).toBe(true);
	});

	it('flags a cycle warning when the assertion would close a loop', () => {
		// alex -> sam already exists; adding sam -> alex closes a cycle.
		const existing = [assertion({ parentId: 'p-alex', childId: 'p-sam' })];
		const plan = planRelationshipCommand(
			{ kind: 'add_parent', child: alex, parent: sam, type: 'biological', role: 'parent', unionLabel: null },
			{ assertions: existing, hasDuplicateName: false, unionCount: 0 }
		);
		expect(plan.warnings.some((w) => w.code === 'CYCLE')).toBe(true);
	});

	it('flags multiple-union ambiguity when ending a union', () => {
		const plan = planRelationshipCommand(
			{ kind: 'end_union', person: alex, unionLabel: 'X' },
			{ assertions: [], hasDuplicateName: false, unionCount: 2 }
		);
		expect(plan.warnings.some((w) => w.code === 'MULTIPLE_UNIONS')).toBe(true);
	});
});
