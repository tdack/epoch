import { describe, expect, it } from 'vitest';
import { partnershipLabels } from '#lib/shared/partnership-labels.js';
import type { RelationshipGraphUnion } from '#lib/server/domain/relationship-graph.js';
import { defaultSurvivor, mergeCandidatesFor } from './merge-candidates.js';

const union = (id: string, partnerIds: string[], childIds: string[] = [], date?: string): RelationshipGraphUnion => ({
	id,
	status: 'active',
	marriageDate: null,
	marriagePlace: null,
	partnerIds,
	version: 3,
	events: date ? [{ id: `e-${id}`, type: 'MARR', dateText: date, dateSort: `${date}-01-01`, place: null }] : [],
	// One row per parent, as `parent_child` stores it.
	children: childIds.flatMap((childId) => partnerIds.map((parentId) => ({ childId, parentId, type: 'biological' as const })))
});

describe('mergeCandidatesFor', () => {
	const unions = [
		union('later', ['b', 'a'], [], '2001'),
		union('first', ['a', 'b'], ['k1', 'k2'], '1980'),
		union('other', ['a', 'c'], ['k3'])
	];
	const labels = partnershipLabels(unions);

	it('lists the union and its twins oldest first, counting each child once', () => {
		const candidates = mergeCandidatesFor(unions, 'later', labels);
		expect(candidates.map((c) => c.id)).toEqual(['first', 'later']);
		expect(candidates[0]).toMatchObject({ title: '1st partnership (m. 1980)', childCount: 2, version: 3 });
	});

	it('is empty for a partnership with no twin', () => {
		expect(mergeCandidatesFor(unions, 'other', labels)).toEqual([]);
		expect(mergeCandidatesFor(unions, 'missing', labels)).toEqual([]);
	});
});

describe('defaultSurvivor', () => {
	it('prefers the partnership with the most children', () => {
		const candidates = [
			{ id: 'a', title: '', childCount: 0, version: 1 },
			{ id: 'b', title: '', childCount: 4, version: 1 },
			{ id: 'c', title: '', childCount: 4, version: 1 }
		];
		expect(defaultSurvivor(candidates)).toBe('b');
		expect(defaultSurvivor([])).toBe('');
	});
});
