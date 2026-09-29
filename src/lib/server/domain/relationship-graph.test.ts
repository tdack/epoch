import { describe, it, expect } from 'vitest';
import { buildRelationshipGraph, isEndedUnionStatus } from './relationship-graph';

describe('buildRelationshipGraph', () => {
	it('preserves repeated unions between the same participants', () => {
		const graph = buildRelationshipGraph({
			people: [
				{ id: 'a', givenName: 'Alex', surname: 'Walker', sex: 'M', isDeceased: false },
				{ id: 'b', givenName: 'Bob', surname: 'Smith', sex: 'M', isDeceased: false }
			],
			unions: [
				{ id: 'u1', status: 'divorced', partnerIds: ['a', 'b'] },
				{ id: 'u2', status: 'active', partnerIds: ['a', 'b'] }
			],
			parentChild: []
		});

		expect(graph.unions).toHaveLength(2);
		expect(graph.unions.map((u) => u.id)).toEqual(['u1', 'u2']);
	});

	it('groups per-parent assertions by union and type', () => {
		const graph = buildRelationshipGraph({
			people: [
				{ id: 'mom1', givenName: 'Alice', surname: null, sex: 'F', isDeceased: false },
				{ id: 'mom2', givenName: 'Carol', surname: null, sex: 'F', isDeceased: false },
				{ id: 'child', givenName: 'Sam', surname: null, sex: 'U', isDeceased: false }
			],
			unions: [{ id: 'u1', status: 'active', partnerIds: ['mom1', 'mom2'] }],
			parentChild: [
				{ parentId: 'mom1', childId: 'child', type: 'biological', unionId: 'u1' },
				{ parentId: 'mom2', childId: 'child', type: 'adoptive', unionId: 'u1' }
			]
		});

		const child = graph.people.find((p) => p.id === 'child')!;
		expect(child.parentsByUnion['u1']).toHaveLength(2);
		expect(child.parentsByUnion['u1'].map((p) => p.type).sort()).toEqual(['adoptive', 'biological']);
	});

	it('derives step parents from a parent\u2019s union', () => {
		const graph = buildRelationshipGraph({
			people: [
				{ id: 'parent', givenName: 'Alex', surname: null, sex: 'U', isDeceased: false },
				{ id: 'stepparent', givenName: 'Jordan', surname: null, sex: 'U', isDeceased: false },
				{ id: 'child', givenName: 'Sam', surname: null, sex: 'U', isDeceased: false }
			],
			unions: [{ id: 'u1', status: 'active', partnerIds: ['parent', 'stepparent'] }],
			parentChild: [{ parentId: 'parent', childId: 'child', type: 'biological', unionId: null }]
		});

		const child = graph.people.find((p) => p.id === 'child')!;
		expect(child.stepParents).toEqual([{ stepParentId: 'stepparent', unionId: 'u1' }]);
	});

	it('marks deceased people', () => {
		const graph = buildRelationshipGraph({
			people: [
				{ id: 'a', givenName: 'Alex', surname: null, sex: 'U', isDeceased: true },
				{ id: 'b', givenName: 'Bob', surname: null, sex: 'U', isDeceased: false }
			],
			unions: [],
			parentChild: []
		});

		expect(graph.people.find((p) => p.id === 'a')!.isDeceased).toBe(true);
		expect(graph.people.find((p) => p.id === 'b')!.isDeceased).toBe(false);
	});
});

describe('isEndedUnionStatus', () => {
	it('recognizes ended statuses', () => {
		expect(isEndedUnionStatus('divorced')).toBe(true);
		expect(isEndedUnionStatus('annulled')).toBe(true);
		expect(isEndedUnionStatus('active')).toBe(false);
	});
});

describe('person life dates', () => {
	it('carries the original birth and death text, defaulting to null', () => {
		const graph = buildRelationshipGraph({
			people: [
				{ id: 'a', givenName: 'Alex', surname: null, sex: 'M', isDeceased: true, birthDate: 'ABT 1900', deathDate: '3 MAR 1970' },
				{ id: 'b', givenName: 'Bob', surname: null, sex: 'M', isDeceased: false }
			],
			unions: [],
			parentChild: []
		});
		expect(graph.people.map((p) => [p.birthDate, p.deathDate])).toEqual([
			['ABT 1900', '3 MAR 1970'],
			[null, null]
		]);
	});
});
