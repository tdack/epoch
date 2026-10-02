import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { individuals, personNames } from '../db/schema';
import { ConcurrencyConflictError, UnauthorizedError } from '../domain/errors';
import {
	addTestMember,
	createTestDatabase,
	createTestTree,
	createTestUser,
	type TestDatabase
} from '../testing/d1';
import { ChangeLogService } from './change-log-service';
import { GenealogyService } from './genealogy-service';
import { NameService } from './name-service';

let t: TestDatabase;
beforeAll(async () => {
	t = await createTestDatabase();
});
afterAll(async () => {
	await t.dispose();
});

async function setup() {
	const actor = await createTestUser(t.db);
	const treeId = await createTestTree(t.db, actor);
	const ctx = actor.context;
	const person = (
		await new GenealogyService(t.db).createIndividual(
			treeId,
			{ givenName: 'Jessica', surname: 'Simpson' },
			ctx
		)
	).individual;
	const names = new NameService(t.db);
	const display = async () => {
		const row = await t.db.select().from(individuals).where(eq(individuals.id, person.id)).get();
		return [row?.givenName, row?.surname].join(' ');
	};
	const rows = () =>
		t.db.select().from(personNames).where(eq(personNames.personId, person.id)).all();
	return { actor, treeId, ctx, person, names, display, rows, log: new ChangeLogService(t.db) };
}

describe('names through the mutation runner', () => {
	it('gives a person created in the editor a preferred name row', async () => {
		const { rows } = await setup();
		expect(await rows()).toMatchObject([
			{ type: 'birth', givenName: 'Jessica', surname: 'Simpson', isPreferred: true }
		]);
	});

	it('adds a married name, makes it preferred, and one undo restores the display name and the flags', async () => {
		const { treeId, ctx, person, names, display, rows, log } = await setup();
		const created = await names.create(
			treeId,
			person.id,
			{ type: 'married', givenName: 'Jessica', surname: 'Smith' },
			false,
			ctx
		);
		expect(created.change?.summary).toBe('Added married name Jessica Wren to Jessica Lovejoy');
		expect(await display()).toBe('Jessica Lovejoy');

		const preferred = await names.setPreferred(treeId, person.id, created.nameId, undefined, ctx);
		expect(preferred.change?.summary).toBe(
			'Chose the married name as the preferred name of Jessica Lovejoy'
		);
		expect(await display()).toBe('Jessica Wren');
		expect((await rows()).filter((n) => n.isPreferred).map((n) => n.surname)).toEqual(['Smith']);

		await log.undoLast(treeId, ctx);
		expect(await display()).toBe('Jessica Lovejoy');
		expect((await rows()).filter((n) => n.isPreferred).map((n) => n.surname)).toEqual(['Simpson']);
	});

	it('edits and deletes a name, each undoable, and removes the name row with the undo of a create', async () => {
		const { treeId, ctx, person, names, rows, log } = await setup();
		const { nameId } = await names.create(
			treeId,
			person.id,
			{ type: 'aka', givenName: 'Shar' },
			false,
			ctx
		);
		const stored = (await rows()).find((n) => n.id === nameId)!;
		await names.update(treeId, nameId, { givenName: 'Sharlee' }, stored.version, ctx);
		expect((await rows()).find((n) => n.id === nameId)).toMatchObject({
			givenName: 'Sharlee',
			version: 2
		});
		await names.remove(treeId, nameId, 2, ctx);
		expect((await rows()).find((n) => n.id === nameId)).toBeUndefined();
		await log.undoLast(treeId, ctx);
		expect((await rows()).find((n) => n.id === nameId)?.givenName).toBe('Sharlee');
		await log.undoLast(treeId, ctx);
		await log.undoLast(treeId, ctx);
		expect((await rows()).find((n) => n.id === nameId)).toBeUndefined();
	});

	it('editing the person form edits the preferred name row, so they never drift', async () => {
		const { treeId, ctx, person, rows } = await setup();
		await new GenealogyService(t.db).updateIndividual(
			treeId,
			person.id,
			person.version,
			{ surname: 'Simpson-Smith' },
			ctx
		);
		expect((await rows()).find((n) => n.isPreferred)).toMatchObject({ surname: 'Simpson-Smith' });
	});

	it('a stale version is a conflict, and a viewer cannot change names', async () => {
		const { treeId, ctx, person, names } = await setup();
		const { nameId } = await names.create(
			treeId,
			person.id,
			{ type: 'aka', givenName: 'Shar' },
			false,
			ctx
		);
		await names.update(treeId, nameId, { givenName: 'Sharlee' }, 1, ctx);
		await expect(
			names.update(treeId, nameId, { givenName: 'Other' }, 1, ctx)
		).rejects.toBeInstanceOf(ConcurrencyConflictError);

		const viewer = await createTestUser(t.db, 'viewer');
		await addTestMember(t.db, treeId, viewer, 'viewer');
		await expect(
			names.create(treeId, person.id, { type: 'aka', givenName: 'X' }, false, viewer.context)
		).rejects.toBeInstanceOf(UnauthorizedError);
	});

	it('previews a name change without writing it', async () => {
		const { treeId, ctx, person, names, rows } = await setup();
		const impact = await names.preview(
			treeId,
			{
				kind: 'create_name',
				personId: person.id,
				nameId: 'preview',
				isPreferred: true,
				name: { type: 'married', givenName: 'Jessica', surname: 'Smith' }
			},
			ctx
		);
		expect(impact.records.map((r) => [r.action, r.label])).toContainEqual([
			'created',
			'Married name Jessica Wren of Jessica Lovejoy'
		]);
		expect(impact.records.some((r) => r.entityType === 'person' && r.action === 'updated')).toBe(
			true
		);
		expect(await rows()).toHaveLength(1);
	});
});
