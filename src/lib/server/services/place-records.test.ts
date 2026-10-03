/**
 * Place records (ADR-019): every fact with a place points at the record for its text, however it
 * was written, and renaming or merging a place is one undoable change that keeps record ids.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import migration from '../../../../drizzle/0016_uneven_sue_storm.sql?raw';
import { events, places } from '../db/schema';
import { UndoRefusedError } from '../domain/errors';
import { NotFoundError, UnauthorizedError } from '../domain/errors';
import type { TreeRole } from '../../shared/roles';
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
import { FactService } from './fact-service';
import { GenealogyService } from './genealogy-service';
import { PlaceService } from './place-service';
import { pointFactsAtPlaces } from '../repositories/place-repository';
import { MAX_PLACE_REWRITE_FACTS } from '../../shared/places';

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
const placeService = () => new PlaceService(t.db);

/** Every fact's record is the one for its text, no text has two records, and no fact without text has one. */
async function expectConsistent(tree = treeId) {
	const rows = await t.db.all<{
		id: string;
		place: string | null;
		placeId: string | null;
		key: string | null;
	}>(
		sql`select e.id as id, e.place as place, e.place_id as placeId, p.name_key as key from events e left join places p on p.id = e.place_id where e.tree_id = ${tree}`
	);
	for (const row of rows) {
		if (row.place)
			expect(row.key, `fact ${row.id} at ${row.place}`).toBe(
				row.place.replace(/[A-Z]/g, (c) => c.toLowerCase())
			);
		else expect(row.placeId).toBeNull();
	}
	const keys = await t.db
		.select({ key: places.nameKey })
		.from(places)
		.where(eq(places.treeId, tree))
		.all();
	expect(new Set(keys.map((k) => k.key)).size).toBe(keys.length);
}

const idOf = async (name: string, who: TreeRole = 'owner') => {
	const page = await placeService().list(treeId, { q: name, limit: 100 }, actors[who].context);
	return page.items.find((p) => p.name.toLowerCase() === name.toLowerCase())!.id;
};
const textsAt = async (name: string) =>
	(await placeService().detail(treeId, name, {}, actors.owner.context)).facts.length;

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
		const rows = await t.db
			.select({ id: events.placeId })
			.from(events)
			.where(and(eq(events.treeId, treeId), eq(events.place, 'Cork, Ireland')))
			.all();
		const lower = await t.db
			.select({ id: events.placeId })
			.from(events)
			.where(and(eq(events.treeId, treeId), eq(events.place, 'cork, ireland')))
			.all();
		expect(rows[0]!.id).not.toBeNull();
		expect(lower[0]!.id).toBe(rows[0]!.id);
	});

	it('keeps them after a merge-mode import, and does not make a record twice', async () => {
		const before = await t.db.select().from(places).where(eq(places.treeId, treeId)).all();
		await importGedcomToDb(
			t.d1,
			treeId,
			FIXTURE.replace('Hobart, Tasmania', 'Launceston'),
			'Places',
			'merge'
		);
		await expectConsistent();
		const after = await t.db.select().from(places).where(eq(places.treeId, treeId)).all();
		expect(after.length).toBeGreaterThanOrEqual(before.length);
		for (const place of before) expect(after.find((p) => p.id === place.id)).toBeTruthy();
	});

	it('follows a fact through create, edit, clearing and delete, and undo of each', async () => {
		const actor = await createTestUser(t.db);
		const tree = await createTestTree(t.db, actor);
		const ctx = actor.context;
		const person = (
			await new GenealogyService(t.db).createIndividual(
				tree,
				{ givenName: 'Wren', surname: 'Ash' },
				ctx
			)
		).individual;
		const facts = new FactService(t.db);
		const log = new ChangeLogService(t.db);
		const placeOf = async (id: string) =>
			(await t.db.select({ id: events.placeId }).from(events).where(eq(events.id, id)).get())!.id;

		const created = await facts.create(
			tree,
			person.id,
			{ ...blank, type: 'BIRT', place: 'Leeds' },
			ctx
		);
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
		const statements = migration
			.split('--> statement-breakpoint')
			.filter((s) => /INSERT INTO `places`|UPDATE `events`/.test(s));
		expect(statements).toHaveLength(2);
		for (const statement of [...statements, ...statements])
			await t.d1.exec(
				statement
					.replace(/^--.*$/gm, '')
					.replace(/\s+/g, ' ')
					.trim()
			);
		await expectConsistent(tree);
		await expectConsistent(treeId);
		const rows = await t.db.select().from(events).where(eq(events.treeId, tree)).all();
		expect(rows.find((r) => r.id === 'b1')!.placeId).toBe(rows.find((r) => r.id === 'b2')!.placeId);
		expect(rows.find((r) => r.id === 'b3')!.placeId).not.toBe(
			rows.find((r) => r.id === 'b1')!.placeId
		);
		expect(rows.filter((r) => r.placeId !== null)).toHaveLength(3);
	});
});

describe('renaming and merging', () => {
	it('renames a place across its facts, in one undoable change; undo finds the old record again', async () => {
		const id = await idOf('Hobart, Tasmania');
		const { change, name } = await placeService().rewrite(
			treeId,
			id,
			'Hobart, TAS',
			actors.owner.context
		);
		expect(name).toBe('Hobart, TAS');
		expect(change?.summary).toBe('Changed the place Hobart, Tasmania to Hobart, TAS');
		// A place is its text, so a new text is a new record; the old one waits, empty, for an undo.
		expect(
			(await placeService().detail(treeId, 'hobart, tas', {}, actors.owner.context)).id
		).not.toBe(id);
		await expect(
			placeService().detail(treeId, 'Hobart, Tasmania', {}, actors.owner.context)
		).rejects.toBeInstanceOf(NotFoundError);
		await expectConsistent();

		await new ChangeLogService(t.db).undoLast(treeId, actors.owner.context);
		expect(
			(await placeService().detail(treeId, 'Hobart, Tasmania', {}, actors.owner.context)).id
		).toBe(id);
		await expectConsistent();
	});

	it('changes only the case of a place when asked to', async () => {
		const id = await idOf('Perthville');
		expect(
			(await placeService().rewrite(treeId, id, 'PERTHVILLE', actors.owner.context)).name
		).toBe('PERTHVILLE');
		expect((await placeService().detail(treeId, 'perthville', {}, actors.owner.context)).name).toBe(
			'PERTHVILLE'
		);
		await new ChangeLogService(t.db).undoLast(treeId, actors.owner.context);
	});

	it("merges into the place that has the name, in that place's spelling, and one undo splits them again", async () => {
		const chapelton = await idOf('Chapelton');
		const cork = await idOf('Cork, Ireland');
		const preview = await placeService().previewRewrite(
			treeId,
			chapelton,
			'CORK, IRELAND',
			actors.owner.context
		);
		expect(preview.headline).toBe('Changed the place Chapelton to Cork, Ireland');

		const { name } = await placeService().rewrite(
			treeId,
			chapelton,
			'CORK, IRELAND',
			actors.owner.context
		);
		expect(name).toBe('Cork, Ireland');
		expect(await textsAt('Cork, Ireland')).toBe(3);
		await expect(
			placeService().detail(treeId, 'Chapelton', {}, actors.owner.context)
		).rejects.toBeInstanceOf(NotFoundError);
		expect(
			(await placeService().list(treeId, { q: 'chapel' }, actors.owner.context)).items
		).toEqual([]);
		await expectConsistent();

		await new ChangeLogService(t.db).undoLast(treeId, actors.owner.context);
		expect(await textsAt('Cork, Ireland')).toBe(2);
		expect((await placeService().detail(treeId, 'Chapelton', {}, actors.owner.context)).id).toBe(
			chapelton
		);
		expect(await idOf('Cork, Ireland')).toBe(cork);
		await expectConsistent();
	});

	it('refuses an empty name, an unknown place, and a place of another tree', async () => {
		const id = await idOf('Chapelton');
		await expect(
			placeService().rewrite(treeId, id, '   ', actors.owner.context)
		).rejects.toBeDefined();
		await expect(
			placeService().rewrite(treeId, 'nope', 'X', actors.owner.context)
		).rejects.toBeInstanceOf(NotFoundError);
		const other = await createTestUser(t.db);
		const otherTree = await createTestTree(t.db, other);
		await expect(placeService().rewrite(otherTree, id, 'X', other.context)).rejects.toBeInstanceOf(
			NotFoundError
		);
	});

	it("bumps a person's version when their birth place changes, so a stale form conflicts", async () => {
		const carl = await t.db.all<{ version: number }>(
			sql`select version from individuals where tree_id = ${treeId} and given_name = 'Carl'`
		);
		await placeService().rewrite(
			treeId,
			await idOf('Hobart, Tasmania'),
			'Hobart',
			actors.owner.context
		);
		const after = await t.db.all<{ version: number }>(
			sql`select version from individuals where tree_id = ${treeId} and given_name = 'Carl'`
		);
		expect(after[0]!.version).toBe(carl[0]!.version + 1);
		await new ChangeLogService(t.db).undoLast(treeId, actors.owner.context);
	});
});

describe('the size of one change', () => {
	it('commits a rename of as many facts as the limit allows, and one undo reverts them all', async () => {
		const actor = await createTestUser(t.db);
		const tree = await createTestTree(t.db, actor);
		const ctx = actor.context;
		const person = (
			await new GenealogyService(t.db).createIndividual(
				tree,
				{ givenName: 'Wren', surname: 'Ash' },
				ctx
			)
		).individual;
		// Each fact is a birth, the dearest kind: it also moves the person's version.
		const rows = Array.from({ length: MAX_PLACE_REWRITE_FACTS }, (_, i) => ({
			id: `cap-${i}`,
			tree,
			person: person.id
		}));
		// D1 binds at most 100 variables a statement, and each row here binds about seven.
		for (let i = 0; i < rows.length; i += 10) {
			await t.db.insert(events).values(
				rows.slice(i, i + 10).map((r) => ({
					id: r.id,
					treeId: r.tree,
					entityType: 'INDIVIDUAL' as const,
					entityId: r.person,
					type: 'BIRT',
					place: 'Leeds'
				}))
			);
		}
		await t.db.batch(pointFactsAtPlaces(t.db, tree));

		const service = new PlaceService(t.db);
		const id = (await service.list(tree, {}, ctx)).items[0]!.id;
		const { change } = await service.rewrite(tree, id, 'Leeds, Yorkshire', ctx);
		expect(change).not.toBeNull();
		await expectConsistent(tree);
		expect((await service.detail(tree, 'Leeds, Yorkshire', { limit: 1 }, ctx)).id).not.toBe(id);

		await new ChangeLogService(t.db).undoLast(tree, ctx);
		await expectConsistent(tree);
		expect((await service.detail(tree, 'Leeds', { limit: 1 }, ctx)).id).toBe(id);
	}, 60_000);
});

describe('undoing a change that a later edit touched', () => {
	it('is refused when the later edit was to a record beyond the first chunk checked', async () => {
		const actor = await createTestUser(t.db);
		const tree = await createTestTree(t.db, actor);
		const ctx = actor.context;
		const person = (
			await new GenealogyService(t.db).createIndividual(
				tree,
				{ givenName: 'Wren', surname: 'Ash' },
				ctx
			)
		).individual;
		for (let i = 0; i < MAX_PLACE_REWRITE_FACTS; i += 10) {
			await t.db.insert(events).values(
				Array.from({ length: 10 }, (_, k) => ({
					id: `late-${i + k}`,
					treeId: tree,
					entityType: 'INDIVIDUAL' as const,
					entityId: person.id,
					type: 'RESI',
					place: 'Hull'
				}))
			);
		}
		await t.db.batch(pointFactsAtPlaces(t.db, tree));
		const service = new PlaceService(t.db);
		const id = (await service.list(tree, {}, ctx)).items[0]!.id;
		await service.rewrite(tree, id, 'Hull, Yorkshire', ctx);

		// Undo is per person, so the later edit is someone else's. The inverse names its records in
		// reverse, so the first fact written is the last the lookup reaches, well past its first 80.
		const other = await createTestUser(t.db, 'editor');
		await addTestMember(t.db, tree, other, 'editor');
		const last = (await t.db.select().from(events).where(eq(events.id, 'late-0')).get())!;
		await new FactService(t.db).update(
			tree,
			last.id,
			{ notes: 'Edited later' },
			last.version,
			other.context
		);

		const refused = await new ChangeLogService(t.db).undoLast(tree, ctx).catch((e) => e);
		expect(refused).toBeInstanceOf(UndoRefusedError);
		expect(refused.message).toContain('Edited the residence');
		// Nothing was reverted.
		expect((await new PlaceService(t.db).list(tree, {}, ctx)).items.map((p) => p.name)).toEqual([
			'Hull, Yorkshire'
		]);
	}, 60_000);
});

describe('who may change a place', () => {
	it('refuses a viewer', async () => {
		const id = await idOf('Chapelton');
		await expect(
			placeService().rewrite(treeId, id, 'X', actors.viewer.context)
		).rejects.toBeInstanceOf(UnauthorizedError);
		await expect(
			placeService().previewRewrite(treeId, id, 'X', actors.viewer.context)
		).rejects.toBeInstanceOf(UnauthorizedError);
	});

	it("answers a contributor naming a private person's place as it answers a place nobody wrote", async () => {
		// A contributor cannot edit at all, so the only thing a rewrite could leak is whether the place
		// exists: a visible one is refused as unauthorised, a hidden one is as missing as no place.
		const perthville = await idOf('Perthville');
		const hidden = await placeService()
			.rewrite(treeId, perthville, 'X', actors.contributor.context)
			.catch((e) => e);
		const missing = await placeService()
			.rewrite(treeId, 'nope', 'X', actors.contributor.context)
			.catch((e) => e);
		expect(hidden).toBeInstanceOf(NotFoundError);
		expect(hidden.message.replace(perthville, 'ID')).toBe(missing.message.replace('nope', 'ID'));
		expect(hidden.message).not.toMatch(/perthville/i);
		expect(
			await placeService()
				.rewrite(treeId, await idOf('Cork, Ireland'), 'X', actors.contributor.context)
				.catch((e) => e)
		).toBeInstanceOf(UnauthorizedError);
		await expectConsistent();
	});

	it("lets an editor, who sees everyone, change a private person's place", async () => {
		const editor = await createTestUser(t.db, 'editor');
		await addTestMember(t.db, treeId, editor, 'editor');
		const { change } = await placeService().rewrite(
			treeId,
			await idOf('Perthville'),
			'Perth',
			editor.context
		);
		expect(change?.summary).toBe('Changed the place Perthville to Perth');
		await new ChangeLogService(t.db).undoLast(treeId, editor.context);
		await expectConsistent();
	});
});
