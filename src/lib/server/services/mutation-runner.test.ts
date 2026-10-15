import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { events } from '../db/schema';
import type { RelationshipCommand } from '../domain/relationship-commands';
import { seedOf } from '../domain/write-scope';
import { seedFor } from '../domain/write-scope/index';
import { PERSON_SCOPES } from '../domain/write-scope/person';
import { EVIDENCE_SCOPES } from '../domain/write-scope/evidence';
import { UNION_SCOPES } from '../domain/write-scope/union';
import { ChangeStore } from '../repositories/change-store';
import { ScopedRowLoader } from '../repositories/scoped-row-loader';
import {
	createTestDatabase,
	createTestTree,
	createTestUser,
	type TestDatabase
} from '../testing/d1';
import { FactService } from './fact-service';
import { PersonService } from './person-service';

let t: TestDatabase;
beforeAll(async () => {
	t = await createTestDatabase();
});
afterAll(async () => {
	await t.dispose();
});
afterEach(() => {
	vi.restoreAllMocks();
	delete PERSON_SCOPES.update_fact;
});

const blank = { dateText: null, place: null, value: null, cause: null, age: null, notes: null };

/** One command of each family, so a table that gained an entry for any of them shows up here. */
const SAMPLE_COMMANDS: RelationshipCommand[] = [
	{ kind: 'create_person', personId: 'p', givenName: 'A', surname: null, sex: 'U' },
	{ kind: 'update_person', personId: 'p', expectedVersion: 1 },
	{ kind: 'delete_person', personId: 'p' },
	{ kind: 'create_fact', personId: 'p', factId: 'f', fact: { ...blank, type: 'BIRT' } },
	{ kind: 'update_fact', factId: 'f', fact: { place: 'York' } },
	{ kind: 'delete_fact', factId: 'f' },
	{ kind: 'delete_name', nameId: 'n' },
	{ kind: 'create_union', unionId: 'u', personIds: ['a', 'b'] },
	{ kind: 'assert_parent_child', parentId: 'a', childId: 'b', type: 'biological', unionId: null },
	{ kind: 'destroy_union', unionId: 'u' }
];

describe('the command scope tables', () => {
	it('give a kind a seed only where its table has an entry, and the rest load the whole tree', () => {
		expect(PERSON_SCOPES).toEqual({});
		expect(EVIDENCE_SCOPES).toEqual({});
		for (const command of SAMPLE_COMMANDS) {
			const hasSeed = UNION_SCOPES[command.kind] !== undefined;
			expect(seedFor([command]) !== null, command.kind).toBe(hasSeed);
		}
	});

	it('send a request to the whole tree if any one of its commands has no seed', () => {
		PERSON_SCOPES.update_fact = (command) => seedOf({ events: [command.factId] });
		const seeded = SAMPLE_COMMANDS.find((c) => c.kind === 'update_fact')!;
		const unseeded = SAMPLE_COMMANDS.find((c) => c.kind === 'delete_fact')!;
		expect(seedFor([seeded])).not.toBeNull();
		expect(seedFor([seeded, unseeded])).toBeNull();
		expect(seedFor([])).toBeNull();
	});
});

describe('the mutation runner loads', () => {
	async function setup() {
		const actor = await createTestUser(t.db);
		const treeId = await createTestTree(t.db, actor);
		const person = (
			await new PersonService(t.db).create(
				treeId,
				{ givenName: 'Wren', surname: 'Ash' },
				actor.context
			)
		).individual;
		const created = await new FactService(t.db).create(
			treeId,
			person.id,
			{ ...blank, type: 'BIRT', dateText: '4 MAR 1900', place: 'Leeds' },
			actor.context
		);
		const fact = (await t.db.select().from(events).where(eq(events.id, created.factId)).all())[0]!;
		return { actor, treeId, fact };
	}

	it('the whole tree for a kind with no seed', async () => {
		const { actor, treeId, fact } = await setup();
		const whole = vi.spyOn(ChangeStore.prototype, 'loadRows');
		const scoped = vi.spyOn(ScopedRowLoader.prototype, 'load');
		await new FactService(t.db).update(
			treeId,
			fact.id,
			{ place: 'York' },
			fact.version,
			actor.context
		);
		expect(whole).toHaveBeenCalled();
		expect(scoped).not.toHaveBeenCalled();
	});

	it('a scoped snapshot once the kind has a seed, and writes the same change', async () => {
		const { actor, treeId, fact } = await setup();
		PERSON_SCOPES.update_fact = (command) => seedOf({ events: [command.factId] });
		const whole = vi.spyOn(ChangeStore.prototype, 'loadRows');
		const scoped = vi.spyOn(ScopedRowLoader.prototype, 'load');
		const result = await new FactService(t.db).update(
			treeId,
			fact.id,
			{ place: 'York' },
			fact.version,
			actor.context
		);
		expect(scoped).toHaveBeenCalledTimes(1);
		expect(whole).not.toHaveBeenCalled();
		expect(result.change?.summary).toBe('Edited the birth of Wren Ash');
		const stored = (await t.db.select().from(events).where(eq(events.id, fact.id)).all())[0]!;
		expect(stored.place).toBe('York');
	});
});
