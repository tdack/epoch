/**
 * Place records (ADR-019): every fact with a place points at the record for its text, however it
 * was written.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import migration from '../../../../drizzle/0016_uneven_sue_storm.sql?raw';
import { events, places } from '../db/schema';
import type { TreeRole } from '../domain/identity';
import { importGedcomToDb } from '../gedcom/importer';
import { addTestMember, createTestDatabase, createTestTree, createTestUser, type TestActor, type TestDatabase } from '../testing/d1';
import { ChangeLogService } from './change-log-service';
import { FactService } from './fact-service';
import { GenealogyService } from './genealogy-service';

const FIXTURE = `0 HEAD
0 @I1@ INDI
1 NAME Alice /Dead/
1 BIRT
2 DATE 1850
2 PLAC Cork, Ireland
1 FAMS @F1@
0 @I2@ INDI
1 NAME Bob /Dead/
1 BIRT
2 DATE 1848
2 PLAC cork, ireland
1 FAMS @F1@
1 FAMS @F2@
0 @I3@ INDI
1 NAME Carl /Dead/
1 BIRT
2 DATE 1860
2 PLAC Hobart, Tasmania
0 @I4@ INDI
1 NAME Livia /Aliveson/
1 BIRT
2 DATE 1990
2 PLAC Perthville
1 FAMS @F2@
0 @F1@ FAM
1 HUSB @I2@
1 WIFE @I1@
1 MARR
2 DATE 1875
2 PLAC Chapelton
0 @F2@ FAM
1 HUSB @I2@
1 WIFE @I4@
1 MARR
2 DATE 1990
2 PLAC Secretstown
0 TRLR`;

const blank = { dateText: null, place: null, value: null, cause: null, age: null, notes: null };
let t: TestDatabase;
let treeId: string;
const actors = {} as Record<TreeRole, TestActor>;

/** Every fact's record is the one for its text, no text has two records, and no fact without text has one. */
async function expectConsistent(tree = treeId) {
	const rows = await t.db.all<{ id: string; place: string | null; placeId: string | null; key: string | null }>(
		sql`select e.id as id, e.place as place, e.place_id as placeId, p.name_key as key from events e left join places p on p.id = e.place_id where e.tree_id = ${tree}`
	);
	for (const row of rows) {
		if (row.place) expect(row.key, `fact ${row.id} at ${row.place}`).toBe(row.place.replace(/[A-Z]/g, (c) => c.toLowerCase()));
		else expect(row.placeId).toBeNull();
	}
	const keys = await t.db.select({ key: places.nameKey }).from(places).where(eq(places.treeId, tree)).all();
	expect(new Set(keys.map((k) => k.key)).size).toBe(keys.length);
}

beforeAll(async () => {
	t = await createTestDatabase();
	actors.owner = await createTestUser(t.db, 'owner');
	treeId = await createTestTree(t.db, actors.owner);
	for (const role of ['contributor', 'viewer'] as const) {
		actors[role] = await createTestUser(t.db, role);
		await addTestMember(t.db, treeId, actors[role], role);
	}
	await importGedcomToDb(t.d1, treeId, FIXTURE, 'Places');
}, 60_000);
afterAll(async () => {
	await t.dispose();
});

describe('records follow the text, whoever wrote it', () => {
	it('points imported facts at one record per place, whatever the case', async () => {
		await expectConsistent();
		const rows = await t.db.select({ id: events.placeId }).from(events).where(and(eq(events.treeId, treeId), eq(events.place, 'Cork, Ireland'))).all();
		const lower = await t.db.select({ id: events.placeId }).from(events).where(and(eq(events.treeId, treeId), eq(events.place, 'cork, ireland'))).all();
		expect(rows[0]!.id).not.toBeNull();
		expect(lower[0]!.id).toBe(rows[0]!.id);
	});

	it('keeps them after a merge-mode import, and does not make a record twice', async () => {
		const before = await t.db.select().from(places).where(eq(places.treeId, treeId)).all();
		await importGedcomToDb(t.d1, treeId, FIXTURE.replace('Hobart, Tasmania', 'Launceston'), 'Places', 'merge');
		await expectConsistent();
		const after = await t.db.select().from(places).where(eq(places.treeId, treeId)).all();
		expect(after.length).toBeGreaterThanOrEqual(before.length);
		for (const place of before) expect(after.find((p) => p.id === place.id)).toBeTruthy();
	});

	it('follows a fact through create, edit, clearing and delete, and undo of each', async () => {
		const actor = await createTestUser(t.db);
		const tree = await createTestTree(t.db, actor);
		const ctx = actor.context;
		const person = (await new GenealogyService(t.db).createIndividual(tree, { givenName: 'Wren', surname: 'Ash' }, ctx)).individual;
		const facts = new FactService(t.db);
		const log = new ChangeLogService(t.db);
		const placeOf = async (id: string) => (await t.db.select({ id: events.placeId }).from(events).where(eq(events.id, id)).get())!.id;

		const created = await facts.create(tree, person.id, { ...blank, type: 'BIRT', place: 'Leeds' }, ctx);
		await expectConsistent(tree);
		const leeds = await placeOf(created.factId);
		expect(leeds).not.toBeNull();

		await facts.update(tree, created.factId, { place: 'LEEDS' }, 1, ctx);
		expect(await placeOf(created.factId)).toBe(leeds);
		await facts.update(tree, created.factId, { place: 'Hull' }, 2, ctx);
		expect(await placeOf(created.factId)).not.toBe(leeds);
		await facts.update(tree, created.factId, { place: null }, 3, ctx);
		expect(await placeOf(created.factId)).toBeNull();
		await expectConsistent(tree);

		// Undo restores the text, and the record the text names is the one it had.
		await log.undoLast(tree, ctx);
		await expectConsistent(tree);
		await log.undoLast(tree, ctx);
		await log.undoLast(tree, ctx);
		expect(await placeOf(created.factId)).toBe(leeds);
		await facts.remove(tree, created.factId, undefined, ctx);
		await log.undoLast(tree, ctx);
		expect(await placeOf(created.factId)).toBe(leeds);
		await expectConsistent(tree);
	});
});

describe('the migration backfill', () => {
	it('gives facts written before records existed their records, once per text', async () => {
		const actor = await createTestUser(t.db);
		const tree = await createTestTree(t.db, actor);
		// As the table was before the migration ran: no records, and no fact pointing at one.
		await t.db.run(sql`update events set place_id = null`);
		await t.db.run(sql`delete from places`);
		await t.db.run(sql`insert into events (id, tree_id, entity_type, entity_id, type, place) values
			('b1', ${tree}, 'INDIVIDUAL', 'x', 'BIRT', 'Leeds'), ('b2', ${tree}, 'INDIVIDUAL', 'x', 'DEAT', 'LEEDS'),
			('b3', ${tree}, 'INDIVIDUAL', 'x', 'RESI', 'Hull'), ('b4', ${tree}, 'INDIVIDUAL', 'x', 'OCCU', null), ('b5', ${tree}, 'INDIVIDUAL', 'x', 'OCCU', '')`);
		const statements = migration.split('--> statement-breakpoint').filter((s) => /INSERT INTO `places`|UPDATE `events`/.test(s));
		expect(statements).toHaveLength(2);
		for (const statement of [...statements, ...statements]) await t.d1.exec(statement.replace(/^--.*$/gm, '').replace(/\s+/g, ' ').trim());
		await expectConsistent(tree);
		await expectConsistent(treeId);
		const rows = await t.db.select().from(events).where(eq(events.treeId, tree)).all();
		expect(rows.find((r) => r.id === 'b1')!.placeId).toBe(rows.find((r) => r.id === 'b2')!.placeId);
		expect(rows.find((r) => r.id === 'b3')!.placeId).not.toBe(rows.find((r) => r.id === 'b1')!.placeId);
		expect(rows.filter((r) => r.placeId !== null)).toHaveLength(3);
	});
});
