/** Standardising dates over a real database: what changes, what never does, undo, and who may. */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { events, personNames } from '../db/schema';
import { UnauthorizedError } from '../domain/errors';
import { importGedcomToDb } from '../testing/gedcom';
import {
	addTestMember,
	createTestDatabase,
	createTestTree,
	createTestUser,
	type TestActor,
	type TestDatabase
} from '../testing/d1';
import { ChangeLogService } from './change-log-service';
import { DateService } from './date-service';

const FIXTURE = `0 HEAD
0 @I1@ INDI
1 NAME John /Smith/
1 BIRT
2 DATE 25 MARCH 1917
1 DEAT
2 DATE 3 RD DECEMBER 1996
1 RESI
2 DATE CIRCA 1937
0 @I2@ INDI
1 NAME Mary /Roe/
1 DEAT
2 DATE 01 MAR 191503 08 1912
1 BURI
2 DATE 4 JUN 1914
1 EVEN
2 DATE (after the war)
0 TRLR`;

let t: TestDatabase;
let treeId: string;
let owner: TestActor;
let editor: TestActor;

beforeAll(async () => {
	t = await createTestDatabase();
	owner = await createTestUser(t.db, 'owner');
	treeId = await createTestTree(t.db, owner);
	editor = await createTestUser(t.db, 'editor');
	await addTestMember(t.db, treeId, editor, 'editor');
	await importGedcomToDb(t.d1, treeId, FIXTURE, 'Dates');
}, 60_000);
afterAll(async () => {
	await t.dispose();
});

const datesNow = async () =>
	(await t.db.select({ dateRaw: events.dateRaw }).from(events).where(eq(events.treeId, treeId)))
		.map((e) => e.dateRaw)
		.sort();

describe('standardising dates', () => {
	it('lists each date that would change, and only those', async () => {
		const preview = await new DateService(t.db).previewStandardise(treeId, owner.context);
		expect(preview.remaining).toBe(0);
		expect(preview.changes).toEqual(
			expect.arrayContaining([
				{ label: 'Birth of John Smith', before: '25 MARCH 1917', after: '25 MAR 1917' },
				{ label: 'Death of John Smith', before: '3 RD DECEMBER 1996', after: '3 DEC 1996' },
				{ label: 'Residence of John Smith', before: 'CIRCA 1937', after: 'ABT 1937' }
			])
		);
		expect(preview.changes).toHaveLength(3);
	});

	it('rewrites them in one change that undo reverts, and leaves the rest alone', async () => {
		const before = await datesNow();
		const { change, remaining } = await new DateService(t.db).standardise(treeId, owner.context);
		expect(change?.summary).toBe('Standardised 3 dates');
		expect(remaining).toBe(0);
		expect(await datesNow()).toEqual(
			[
				'25 MAR 1917',
				'3 DEC 1996',
				'ABT 1937',
				'01 MAR 191503 08 1912',
				'4 JUN 1914',
				'(after the war)'
			].sort()
		);
		const [death] = await t.db
			.select()
			.from(events)
			.where(eq(events.dateRaw, '3 DEC 1996'))
			.limit(1);
		expect(death.dateSort).toBe('1996-12-03');

		// A second turn finds nothing to do.
		expect((await new DateService(t.db).previewStandardise(treeId, owner.context)).changes).toEqual(
			[]
		);

		await new ChangeLogService(t.db).undoLast(treeId, owner.context);
		expect(await datesNow()).toEqual(before);
	});

	it('is a manager’s action', async () => {
		await expect(
			new DateService(t.db).previewStandardise(treeId, editor.context)
		).rejects.toBeInstanceOf(UnauthorizedError);
		await expect(new DateService(t.db).standardise(treeId, editor.context)).rejects.toBeInstanceOf(
			UnauthorizedError
		);
	});

	it('reaches name dates too', async () => {
		const [name] = await t.db.select().from(personNames).limit(1);
		await t.db
			.update(personNames)
			.set({ dateRaw: '2 FEBUARY 1900' })
			.where(eq(personNames.id, name.id));
		const preview = await new DateService(t.db).previewStandardise(treeId, owner.context);
		expect(preview.changes).toContainEqual(
			expect.objectContaining({ before: '2 FEBUARY 1900', after: '2 FEB 1900' })
		);
	});
});
