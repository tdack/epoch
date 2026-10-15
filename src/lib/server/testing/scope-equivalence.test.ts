import { describe, expect, it } from 'vitest';
import type { RelationshipCommand } from '../domain/relationship-commands';
import { emptySeed, seedOf } from '../domain/write-scope';
import { treeRows } from './rows';
import { expectScopedEqualsWhole, planOutcome, viewerScopes } from './scope-equivalence';

const scopes = viewerScopes();

function world() {
	const rows = treeRows({
		people: [
			{ id: 'a', givenName: 'Ann', surname: 'Ash' },
			{ id: 'b', givenName: 'Bede', surname: 'Ash' },
			// Born with no end bound for the date: living, so private to a viewer who did not add them.
			{ id: 'p', givenName: 'Priv', surname: 'Ate', birth: '1990' }
		],
		// Dated with an end bound, so the privacy rule sees them as long dead rather than living.
		events: ['a', 'b'].map((id) => ({
			id: `birt-${id}`,
			entityId: id,
			type: 'BIRT',
			dateRaw: '1902',
			dateSort: '1902-01-01',
			dateSortEnd: '1902-12-31'
		})),
		unions: [{ id: 'u1', partners: ['a', 'b'] }],
		links: [{ parentId: 'a', childId: 'p', unionId: 'u1' }]
	});
	rows.individuals.find((person) => person.id === 'p')!.createdBy = 'creator-1';
	return rows;
}

const updateFact: RelationshipCommand = {
	kind: 'update_fact',
	factId: 'birt-b',
	fact: { place: 'York' }
};

describe('scope equivalence harness', () => {
	it('passes when the seed covers what the planner reads, for every kind of viewer', () => {
		for (const scope of Object.values(scopes)) {
			const outcome = expectScopedEqualsWhole({
				whole: world(),
				commands: [updateFact],
				scope,
				seed: seedOf({ events: ['birt-b'] })
			});
			expect(outcome.failure).toBeUndefined();
			expect(outcome.ops?.length).toBeGreaterThan(0);
			expect(outcome.preview?.records.length).toBeGreaterThan(0);
		}
	});

	it('fails with a deliberately wrong seed: an empty one cannot find the fact', () => {
		const wholeOutcome = planOutcome(world(), [updateFact], scopes.unrestricted);
		expect(wholeOutcome.failure).toBeUndefined();
		expect(() =>
			expectScopedEqualsWhole({
				whole: world(),
				commands: [updateFact],
				scope: scopes.unrestricted,
				seed: emptySeed()
			})
		).toThrow();
	});

	it('fails when a seed names the wrong record', () => {
		// p is a child of a, and a's far end does not bring a's partner b, who owns the fact.
		expect(() =>
			expectScopedEqualsWhole({
				whole: world(),
				commands: [updateFact],
				scope: scopes.unrestricted,
				seed: seedOf({ people: ['p'] })
			})
		).toThrow();
	});

	it('compares thrown errors by class and message, and accepts the same failure on both sides', () => {
		const missing: RelationshipCommand = { kind: 'delete_fact', factId: 'no-such-fact' };
		const outcome = expectScopedEqualsWhole({
			whole: world(),
			commands: [missing],
			scope: scopes.unrestricted,
			seed: seedOf({ events: ['no-such-fact'] })
		});
		expect(outcome.failure).toMatchObject({ name: 'NotFoundError' });
	});

	it('treats a private id like a missing one for a restricted viewer, scoped or not', () => {
		const touchPrivate: RelationshipCommand = {
			kind: 'update_person',
			personId: 'p',
			givenName: 'Changed'
		};
		for (const scope of [scopes.restricted, scopes.contributor]) {
			const outcome = expectScopedEqualsWhole({
				whole: world(),
				commands: [touchPrivate],
				scope,
				seed: seedOf({ people: ['p'] })
			});
			// The contributor created p and may edit; the plain viewer is told p does not exist.
			if (scope === scopes.restricted) expect(outcome.failure).toBeDefined();
			else expect(outcome.failure).toBeUndefined();
		}
	});

	it('uses a fresh deterministic clock on each side, so generated ids and times match', () => {
		const create: RelationshipCommand = {
			kind: 'create_fact',
			personId: 'a',
			factId: 'new-fact',
			fact: {
				type: 'DEAT',
				dateText: '1980',
				place: null,
				value: null,
				cause: null,
				age: null,
				notes: null
			}
		};
		const first = planOutcome(world(), [create], scopes.unrestricted);
		const second = planOutcome(world(), [create], scopes.unrestricted);
		expect(second).toEqual(first);
	});
});
