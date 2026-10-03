import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { events } from '../db/schema';
import { ConcurrencyConflictError, UnauthorizedError } from '../domain/errors';
import {
	addTestMember,
	createTestDatabase,
	createTestTree,
	createTestUser,
	type TestDatabase
} from '../testing/d1';
import { ChangeLogService } from './change-log-service';
import { FactService } from './fact-service';
import { PersonService } from './person-service';

let t: TestDatabase;
beforeAll(async () => {
	t = await createTestDatabase();
});
afterAll(async () => {
	await t.dispose();
});

const blank = { dateText: null, place: null, value: null, cause: null, age: null, notes: null };

async function setup() {
	const actor = await createTestUser(t.db);
	const treeId = await createTestTree(t.db, actor);
	const ctx = actor.context;
	const person = (
		await new PersonService(t.db).create(treeId, { givenName: 'Wren', surname: 'Ash' }, ctx)
	).individual;
	const facts = new FactService(t.db);
	const rowsOf = async (personId = person.id) =>
		(
			await t.db
				.select()
				.from(events)
				.where(and(eq(events.treeId, treeId), eq(events.entityId, personId)))
				.all()
		).sort((a, b) => a.type.localeCompare(b.type) || a.dateRaw!.localeCompare(b.dateRaw!));
	return { actor, treeId, ctx, person, facts, rowsOf, log: new ChangeLogService(t.db) };
}

describe('facts through the mutation runner', () => {
	it('keeps two conflicting births, edits one, and undo restores it while the other is untouched', async () => {
		const { treeId, ctx, person, facts, rowsOf, log } = await setup();
		const first = await facts.create(
			treeId,
			person.id,
			{ ...blank, type: 'BIRT', dateText: '4 MAR 1900', place: 'Leeds' },
			ctx
		);
		const second = await facts.create(
			treeId,
			person.id,
			{ ...blank, type: 'BIRT', dateText: '5 MAR 1900', place: 'Hull' },
			ctx
		);
		expect((await rowsOf()).map((f) => f.place)).toEqual(['Leeds', 'Hull']);

		const before = await rowsOf();
		const secondRow = before.find((f) => f.id === second.factId)!;
		const edited = await facts.update(
			treeId,
			second.factId,
			{ place: 'York' },
			secondRow.version,
			ctx
		);
		expect(edited.change?.summary).toBe('Edited the birth of Wren Ash');
		const afterEdit = await rowsOf();
		expect(afterEdit.find((f) => f.id === first.factId)).toEqual(
			before.find((f) => f.id === first.factId)
		);
		expect(afterEdit.find((f) => f.id === second.factId)?.place).toBe('York');

		await log.undoLast(treeId, ctx);
		const afterUndo = await rowsOf();
		expect(afterUndo.find((f) => f.id === second.factId)).toMatchObject({
			place: 'Hull',
			dateRaw: '5 MAR 1900'
		});
		expect(afterUndo.find((f) => f.id === first.factId)).toEqual(
			before.find((f) => f.id === first.factId)
		);
	});

	it('logs a delete and undoes it, and a create and undoes it', async () => {
		const { treeId, ctx, person, facts, rowsOf, log } = await setup();
		const created = await facts.create(
			treeId,
			person.id,
			{ ...blank, type: 'OCCU', value: 'Carpenter' },
			ctx
		);
		expect(created.change?.summary).toBe('Added occupation to Wren Ash');
		await facts.remove(treeId, created.factId, undefined, ctx);
		expect(await rowsOf()).toHaveLength(0);
		await log.undoLast(treeId, ctx);
		expect((await rowsOf()).map((f) => f.value)).toEqual(['Carpenter']);
		await log.undoLast(treeId, ctx);
		expect(await rowsOf()).toHaveLength(0);
	});

	it('previews what a change would write without writing it', async () => {
		const { treeId, ctx, person, facts, rowsOf } = await setup();
		const impact = await facts.preview(
			treeId,
			{
				kind: 'create_fact',
				personId: person.id,
				factId: 'preview',
				fact: { ...blank, type: 'RESI', value: 'Leeds' }
			},
			ctx
		);
		expect(impact.records.map((r) => [r.action, r.label])).toContainEqual([
			'created',
			'Residence (Leeds) of Wren Ash'
		]);
		expect(await rowsOf()).toHaveLength(0);
	});

	it('answers a stale edit with a conflict that carries the stored fact', async () => {
		const { treeId, ctx, person, facts } = await setup();
		const { factId } = await facts.create(
			treeId,
			person.id,
			{ ...blank, type: 'RESI', place: 'Leeds' },
			ctx
		);
		await facts.update(treeId, factId, { place: 'Hull' }, 1, ctx);
		const stale = facts.update(treeId, factId, { place: 'York' }, 1, ctx);
		await expect(stale).rejects.toBeInstanceOf(ConcurrencyConflictError);
		await expect(stale).rejects.toMatchObject({
			details: { entity: 'fact', currentVersion: 2, current: { place: 'Hull' } }
		});
	});

	it('lets an editor write and refuses a viewer both the change and its preview', async () => {
		const { treeId, person, facts } = await setup();
		const viewer = await createTestUser(t.db, 'viewer');
		await addTestMember(t.db, treeId, viewer, 'viewer');
		await expect(
			facts.create(treeId, person.id, { ...blank, type: 'OCCU' }, viewer.context)
		).rejects.toBeInstanceOf(UnauthorizedError);
		// A preview names the records it would touch, so it needs the rights the change needs.
		await expect(
			facts.preview(treeId, { kind: 'delete_fact', factId: 'x' }, viewer.context)
		).rejects.toBeInstanceOf(UnauthorizedError);
	});
});
