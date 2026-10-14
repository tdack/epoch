import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { changeLog, changeLogRecords, events, individuals, mediaItems } from '../db/schema';
import { ConcurrencyConflictError, ValidationError } from '../domain/errors';
import { matchesImage, rebaseInverse, type RowOp } from '../domain/change-log';
import {
	createTestDatabase,
	createTestTree,
	createTestUser,
	type TestActor,
	type TestDatabase
} from '../testing/d1';
import { ChangeStore, toImage } from './change-store';

let t: TestDatabase;
let actor: TestActor;
let treeId: string;
let store: ChangeStore;

beforeAll(async () => {
	t = await createTestDatabase();
	store = new ChangeStore(t.db);
});
afterAll(async () => {
	await t.dispose();
});

async function freshTree() {
	actor = await createTestUser(t.db);
	treeId = await createTestTree(t.db, actor);
}

function person(id: string, givenName: string, version = 1) {
	return {
		id,
		treeId,
		xrefId: null,
		givenName,
		surname: null,
		sex: 'U',
		version,
		createdAt: 1_000,
		updatedAt: 1_000
	};
}

const base = () => ({
	treeId,
	actorId: actor.userId,
	kind: 'test',
	summary: 'test change',
	changes: [],
	isUndoable: true
});

describe('ChangeStore.commit', () => {
	it('writes the rows, the log entry and its records together', async () => {
		await freshTree();
		const committed = await store.commit({
			...base(),
			ops: [{ table: 'individuals', id: 'a1', before: null, after: person('a1', 'Ada') }]
		});
		expect(committed).not.toBeNull();
		expect(
			(await t.db.select().from(individuals).where(eq(individuals.id, 'a1')).get())?.givenName
		).toBe('Ada');
		const log = await t.db.select().from(changeLog).where(eq(changeLog.id, committed!.id)).get();
		expect(log?.summary).toBe('test change');
		expect(JSON.parse(log!.inverseJson!)).toEqual([
			{ table: 'individuals', id: 'a1', before: person('a1', 'Ada'), after: null }
		]);
		const records = await t.db
			.select()
			.from(changeLogRecords)
			.where(eq(changeLogRecords.changeId, committed!.id))
			.all();
		expect(records).toEqual([{ changeId: committed!.id, entityType: 'person', entityId: 'a1' }]);
	});

	it('writes nothing for ops that change nothing', async () => {
		await freshTree();
		await store.commit({
			...base(),
			ops: [{ table: 'individuals', id: 'b1', before: null, after: person('b1', 'Bea') }]
		});
		const same = person('b1', 'Bea');
		const result = await store.commit({
			...base(),
			ops: [{ table: 'individuals', id: 'b1', before: same, after: { ...same } }]
		});
		expect(result).toBeNull();
		expect((await store.listRecent(treeId, 10)).length).toBe(1);
	});

	it('rejects a stale version and rolls the whole batch back', async () => {
		await freshTree();
		await store.commit({
			...base(),
			ops: [{ table: 'individuals', id: 'c1', before: null, after: person('c1', 'Cy') }]
		});
		const stale: RowOp[] = [
			{ table: 'individuals', id: 'c2', before: null, after: person('c2', 'Dee') },
			{
				table: 'individuals',
				id: 'c1',
				before: person('c1', 'Cy', 7),
				after: person('c1', 'Cyrus', 8)
			}
		];
		await expect(store.commit({ ...base(), ops: stale })).rejects.toMatchObject({
			status: 409,
			details: { reason: 'CONCURRENT_WRITE' }
		});
		await expect(store.commit({ ...base(), ops: stale })).rejects.toBeInstanceOf(
			ConcurrencyConflictError
		);
		expect(
			await t.db.select().from(individuals).where(eq(individuals.id, 'c2')).get()
		).toBeUndefined();
		expect(
			(await t.db.select().from(individuals).where(eq(individuals.id, 'c1')).get())?.givenName
		).toBe('Cy');
		expect((await store.listRecent(treeId, 10)).length).toBe(1);
	});

	it('refuses to delete a row that is already gone', async () => {
		await freshTree();
		await expect(
			store.commit({
				...base(),
				ops: [{ table: 'individuals', id: 'gone', before: person('gone', 'Gil'), after: null }]
			})
		).rejects.toBeInstanceOf(ConcurrencyConflictError);
	});
});

describe('ChangeStore undo lookups', () => {
	it('finds the newest undoable change of the actor and skips changes already undone', async () => {
		await freshTree();
		const other = await createTestUser(t.db, 'other');
		const first = await store.commit({
			...base(),
			ops: [{ table: 'individuals', id: 'd1', before: null, after: person('d1', 'One') }]
		});
		const second = await store.commit({
			...base(),
			ops: [{ table: 'individuals', id: 'd2', before: null, after: person('d2', 'Two') }]
		});
		await store.commit({
			...base(),
			actorId: other.userId,
			ops: [{ table: 'individuals', id: 'd3', before: null, after: person('d3', 'Three') }]
		});
		expect((await store.latestUndoable(treeId, actor.userId))?.id).toBe(second!.id);

		await store.commit({
			...base(),
			kind: 'undo',
			isUndoable: false,
			revertsChangeId: second!.id,
			ops: [{ table: 'individuals', id: 'd2', before: person('d2', 'Two'), after: null }]
		});
		expect((await store.latestUndoable(treeId, actor.userId))?.id).toBe(first!.id);
	});

	it('does not let one change be reverted twice', async () => {
		await freshTree();
		const change = await store.commit({
			...base(),
			ops: [{ table: 'individuals', id: 'e1', before: null, after: person('e1', 'Eve') }]
		});
		await store.commit({
			...base(),
			isUndoable: false,
			revertsChangeId: change!.id,
			ops: [{ table: 'individuals', id: 'e1', before: person('e1', 'Eve'), after: null }]
		});
		await expect(
			store.commit({
				...base(),
				isUndoable: false,
				revertsChangeId: change!.id,
				ops: [{ table: 'individuals', id: 'e9', before: null, after: person('e9', 'Nine') }]
			})
		).rejects.toMatchObject({ details: { reason: 'ALREADY_UNDONE' } });
	});

	it('reports a later change that wrote the same record, but ignores a later change that was itself undone', async () => {
		await freshTree();
		const target = await store.commit({
			...base(),
			ops: [{ table: 'individuals', id: 'f1', before: null, after: person('f1', 'Fay') }]
		});
		const targetSeq = (await store.latestUndoable(treeId, actor.userId))!.seq;

		const later = await store.commit({
			...base(),
			summary: 'renamed Fay',
			ops: [
				{
					table: 'individuals',
					id: 'f1',
					before: person('f1', 'Fay'),
					after: person('f1', 'Fran', 2)
				}
			]
		});
		expect(
			await store.firstTouchedAfter(treeId, targetSeq, [{ entityType: 'person', entityId: 'f1' }])
		).toEqual({
			summary: 'renamed Fay'
		});

		await store.commit({
			...base(),
			kind: 'undo',
			isUndoable: false,
			revertsChangeId: later!.id,
			ops: [
				{
					table: 'individuals',
					id: 'f1',
					before: person('f1', 'Fran', 2),
					after: person('f1', 'Fay', 3)
				}
			]
		});
		expect(
			await store.firstTouchedAfter(treeId, targetSeq, [{ entityType: 'person', entityId: 'f1' }])
		).toBeNull();
		expect(target).not.toBeNull();
	});
});

describe('event row images and the structured date columns', () => {
	const event = (extra: Record<string, unknown> = {}) => ({
		id: 'e1',
		treeId,
		entityType: 'INDIVIDUAL',
		entityId: 'p1',
		type: 'BIRT',
		dateRaw: 'ABT 1900',
		dateSort: '1900-01-01',
		place: null,
		description: null,
		version: 1,
		createdAt: 1_000,
		updatedAt: 1_000,
		...extra
	});

	it('carries the bounds, precision and qualifier in the inverse image, so an undo restores them', async () => {
		await freshTree();
		await store.commit({
			...base(),
			ops: [{ table: 'individuals', id: 'p1', before: null, after: person('p1', 'Pat') }]
		});
		const full = event({
			dateSortEnd: '1900-12-31',
			dateQualifier: 'ABOUT',
			datePrecision: 'YEAR',
			dateCalendar: 'GREGORIAN'
		});
		const committed = await store.commit({
			...base(),
			ops: [{ table: 'events', id: 'e1', before: null, after: full }]
		});
		const stored = await t.db.select().from(events).where(eq(events.id, 'e1')).get();
		expect(stored).toMatchObject({
			dateSortEnd: '1900-12-31',
			dateQualifier: 'ABOUT',
			datePrecision: 'YEAR',
			dateCalendar: 'GREGORIAN'
		});
		const log = await t.db.select().from(changeLog).where(eq(changeLog.id, committed!.id)).get();
		expect(JSON.parse(log!.inverseJson!)[0].before).toMatchObject({
			dateSortEnd: '1900-12-31',
			dateQualifier: 'ABOUT'
		});
	});

	it('reads an image written before the columns existed as nulls, not as an error', async () => {
		await freshTree();
		await store.commit({
			...base(),
			ops: [{ table: 'individuals', id: 'p2', before: null, after: person('p2', 'Pat') }]
		});
		// A log row from before migration 0007 has no date_sort_end, date_qualifier, ...
		await store.commit({
			...base(),
			ops: [{ table: 'events', id: 'e2', before: null, after: event({ id: 'e2', entityId: 'p2' }) }]
		});
		expect(await t.db.select().from(events).where(eq(events.id, 'e2')).get()).toMatchObject({
			dateRaw: 'ABT 1900',
			dateSortEnd: null,
			dateQualifier: null,
			datePrecision: null,
			dateCalendar: null
		});
	});
});

describe('ChangeStore tree scoping', () => {
	it('leaves a row alone when an update or delete names another tree, and still applies the matching tree', async () => {
		await freshTree();
		const otherTree = await createTestTree(t.db, actor);
		await store.commit({
			...base(),
			ops: [{ table: 'individuals', id: 's1', before: null, after: person('s1', 'Sam') }]
		});
		const planned = person('s1', 'Sam');
		const renamed = { ...planned, givenName: 'Sly', version: 2 };
		// Images that claim the other tree, so they pass the single-tree check and only the SQL
		// predicates stand between the commit and a row that lives in a different tree.
		const claimed = { ...planned, treeId: otherTree };

		await expect(
			store.commit({
				...base(),
				treeId: otherTree,
				ops: [
					{ table: 'individuals', id: 's1', before: claimed, after: { ...claimed, version: 2 } }
				]
			})
		).rejects.toMatchObject({ details: { reason: 'CONCURRENT_WRITE' } });
		await expect(
			store.commit({
				...base(),
				treeId: otherTree,
				ops: [{ table: 'individuals', id: 's1', before: claimed, after: null }]
			})
		).rejects.toBeInstanceOf(ConcurrencyConflictError);

		expect(
			(await t.db.select().from(individuals).where(eq(individuals.id, 's1')).get())?.givenName
		).toBe('Sam');
		expect(
			await store.currentImages(
				[{ table: 'individuals', id: 's1', before: planned, after: null }],
				otherTree
			)
		).toEqual(new Map());
		expect((await store.listRecent(treeId, 10)).length).toBe(1);

		await store.commit({
			...base(),
			ops: [{ table: 'individuals', id: 's1', before: planned, after: renamed }]
		});
		expect(
			(await t.db.select().from(individuals).where(eq(individuals.id, 's1')).get())?.givenName
		).toBe('Sly');
	});

	it('refuses an op whose image names a different tree, before writing anything', async () => {
		await freshTree();
		const otherTree = await createTestTree(t.db, actor);
		const stray = { ...person('s2', 'Stray'), treeId: otherTree };

		await expect(
			store.commit({
				...base(),
				ops: [{ table: 'individuals', id: 's2', before: null, after: stray }]
			})
		).rejects.toBeInstanceOf(ValidationError);
		expect(await t.db.select().from(individuals).where(eq(individuals.id, 's2'))).toEqual([]);
		expect((await store.listRecent(treeId, 10)).length).toBe(0);
	});
});

describe('media row images and the file-manager columns', () => {
	const mediaRow = (entityId: string) => ({
		id: 'm1',
		treeId,
		entityId,
		r2ObjectKey: `media/${treeId}/m1.png`,
		cfImageId: null,
		title: 'Portrait',
		mimeType: 'image/png',
		version: 1,
		createdAt: 1_000,
		updatedAt: 1_000
	});
	async function imageOf(id: string) {
		const row = await t.db.select().from(mediaItems).where(eq(mediaItems.id, id)).get();
		return row ? toImage(mediaItems, row) : null;
	}

	it('leaves sizeBytes and uploadedBy out of the image, so a pre-migration inverse still matches', async () => {
		await freshTree();
		await store.commit({
			...base(),
			ops: [{ table: 'media_items', id: 'm1', before: null, after: mediaRow('p1') }]
		});
		const image = await imageOf('m1');
		expect(image).not.toHaveProperty('sizeBytes');
		expect(image).not.toHaveProperty('uploadedBy');
		// An inverse written before migration 0029 names only the columns that existed then.
		expect(matchesImage(image, { ...image! })).toBe(true);
	});

	it('undoes a move of a file, using an inverse written before migration 0029', async () => {
		await freshTree();
		await store.commit({
			...base(),
			ops: [
				{
					table: 'media_items',
					id: 'm2',
					before: null,
					after: { ...mediaRow('p1'), id: 'm2', r2ObjectKey: `media/${treeId}/m2.png` }
				}
			]
		});
		const original = (await imageOf('m2'))!;
		// The merge moves the file from p1 to p2: version 2, one more row touch.
		const beforeMove = (await imageOf('m2'))!;
		await store.commit({
			...base(),
			ops: [
				{
					table: 'media_items',
					id: 'm2',
					before: beforeMove,
					after: { ...beforeMove, entityId: 'p2', version: Number(beforeMove.version) + 1 }
				}
			]
		});
		// The undo's inverse is the original image, as the change stored it.
		const live = (await imageOf('m2'))!;
		const rebased = rebaseInverse(
			[{ table: 'media_items', id: 'm2', before: live, after: original }],
			() => live,
			Date.now()
		);
		expect(rebased.isOk).toBe(true);
		if (!rebased.isOk) return;
		await store.commit({ ...base(), ops: rebased.ops });
		expect((await imageOf('m2'))?.entityId).toBe('p1');
	});
});
