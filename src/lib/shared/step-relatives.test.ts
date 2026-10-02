import { describe, expect, it } from 'vitest';
import { buildRelationshipGraph } from '../server/domain/relationship-graph';
import { stepRelativesOf } from './step-relatives';

const person = (id: string) => ({
	id,
	givenName: id,
	surname: null,
	sex: 'U' as const,
	isDeceased: false
});

describe('stepRelativesOf', () => {
	// Ann and Ben have Cal. Ann later partners with Dee, who is not Cal's parent.
	const graph = buildRelationshipGraph({
		people: ['ann', 'ben', 'cal', 'dee'].map(person),
		unions: [
			{ id: 'u1', status: 'active', partnerIds: ['ann', 'ben'] },
			{ id: 'u2', status: 'active', partnerIds: ['ann', 'dee'] }
		],
		parentChild: [
			{ parentId: 'ann', childId: 'cal', type: 'biological', unionId: 'u1' },
			{ parentId: 'ben', childId: 'cal', type: 'biological', unionId: 'u1' }
		]
	});

	it('lists a parent’s new partner as the child’s step-parent, and the child as theirs', () => {
		expect(stepRelativesOf(graph, 'cal').stepParents).toEqual([{ personId: 'dee', unionId: 'u2' }]);
		expect(stepRelativesOf(graph, 'dee').stepChildren).toEqual([
			{ personId: 'cal', viaPartnerId: 'ann', unionId: 'u2' }
		]);
	});

	it('does not call a parent’s own co-parent, or a person’s own child, a step relative', () => {
		expect(stepRelativesOf(graph, 'ann')).toEqual({ stepParents: [], stepChildren: [] });
		expect(stepRelativesOf(graph, 'ben').stepChildren).toEqual([]);
		expect(stepRelativesOf(graph, 'cal').stepParents.map((s) => s.personId)).not.toContain('ben');
	});

	it('lists a step-child once even when two partners are their parents', () => {
		const g = buildRelationshipGraph({
			people: ['ann', 'ben', 'cal', 'dee'].map(person),
			unions: [
				{ id: 'u1', status: 'active', partnerIds: ['ann', 'ben'] },
				{ id: 'u2', status: 'active', partnerIds: ['dee', 'ann'] }
			],
			parentChild: [
				{ parentId: 'ann', childId: 'cal', type: 'biological', unionId: 'u1' },
				{ parentId: 'ben', childId: 'cal', type: 'biological', unionId: 'u1' }
			]
		});
		expect(stepRelativesOf(g, 'dee').stepChildren).toHaveLength(1);
	});
});
