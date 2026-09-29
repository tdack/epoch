import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { changeLog, changeLogRecords, individuals } from '../db/schema';
import { ConcurrencyConflictError } from '../domain/errors';
import type { RowOp } from '../domain/change-log';
import { createTestDatabase, createTestTree, createTestUser, type TestActor, type TestDatabase } from '../testing/d1';
import { ChangeStore } from './change-store';

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
	return { id, treeId, xrefId: null, givenName, surname: null, sex: 'U', version, createdAt: 1_000, updatedAt: 1_000 };
}

const base = () => ({ treeId, actorId: actor.userId, kind: 'test', summary: 'test change', changes: [], isUndoable: true });

describe('ChangeStore.commit', () => {
	it('writes the rows, the log entry and its records together', async () => {
		await freshTree();
		const committed = await store.commit({
			...base(),
			ops: [{ table: 'individuals', id: 'a1', before: null, after: person('a1', 'Ada') }]
		});
		expect(committed).not.toBeNull();
		expect((await t.db.select().from(individuals).where(eq(individuals.id, 'a1')).get())?.givenName).toBe('Ada');
		const log = await t.db.select().from(changeLog).where(eq(changeLog.id, committed!.id)).get();
		expect(log?.summary).toBe('test change');
		expect(JSON.parse(log!.inverseJson!)).toEqual([
			{ table: 'individuals', id: 'a1', before: person('a1', 'Ada'), after: null }
		]);
		const records = await t.db.select().from(changeLogRecords).where(eq(changeLogRecords.changeId, committed!.id)).all();
		expect(records).toEqual([{ changeId: committed!.id, entityType: 'person', entityId: 'a1' }]);
	});

	it('writes nothing for ops that change nothing', async () => {
		await freshTree();
		await store.commit({ ...base(), ops: [{ table: 'individuals', id: 'b1', before: null, after: person('b1', 'Bea') }] });
		const same = person('b1', 'Bea');
		const result = await store.commit({ ...base(), ops: [{ table: 'individuals', id: 'b1', before: same, after: { ...same } }] });
		expect(result).toBeNull();
		expect((await store.listRecent(treeId, 10)).length).toBe(1);
	});

	it('rejects a stale version and rolls the whole batch back', async () => {
		await freshTree();
		await store.commit({ ...base(), ops: [{ table: 'individuals', id: 'c1', before: null, after: person('c1', 'Cy') }] });
		const stale: RowOp[] = [
			{ table: 'individuals', id: 'c2', before: null, after: person('c2', 'Dee') },
			{ table: 'individuals', id: 'c1', before: person('c1', 'Cy', 7), after: person('c1', 'Cyrus', 8) }
		];
		await expect(store.commit({ ...base(), ops: stale })).rejects.toMatchObject({
			status: 409,
			details: { reason: 'CONCURRENT_WRITE' }
		});
		await expect(store.commit({ ...base(), ops: stale })).rejects.toBeInstanceOf(ConcurrencyConflictError);
		expect(await t.db.select().from(individuals).where(eq(individuals.id, 'c2')).get()).toBeUndefined();
		expect((await t.db.select().from(individuals).where(eq(individuals.id, 'c1')).get())?.givenName).toBe('Cy');
		expect((await store.listRecent(treeId, 10)).length).toBe(1);
	});

	it('refuses to delete a row that is already gone', async () => {
		await freshTree();
		await expect(
			store.commit({ ...base(), ops: [{ table: 'individuals', id: 'gone', before: person('gone', 'Gil'), after: null }] })
		).rejects.toBeInstanceOf(ConcurrencyConflictError);
	});
});

describe('ChangeStore undo lookups', () => {
	it('finds the newest undoable change of the actor and skips changes already undone', async () => {
		await freshTree();
		const other = await createTestUser(t.db, 'other');
		const first = await store.commit({ ...base(), ops: [{ table: 'individuals', id: 'd1', before: null, after: person('d1', 'One') }] });
		const second = await store.commit({ ...base(), ops: [{ table: 'individuals', id: 'd2', before: null, after: person('d2', 'Two') }] });
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
		const change = await store.commit({ ...base(), ops: [{ table: 'individuals', id: 'e1', before: null, after: person('e1', 'Eve') }] });
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
		const target = await store.commit({ ...base(), ops: [{ table: 'individuals', id: 'f1', before: null, after: person('f1', 'Fay') }] });
		const targetSeq = (await store.latestUndoable(treeId, actor.userId))!.seq;

		const later = await store.commit({
			...base(),
			summary: 'renamed Fay',
			ops: [{ table: 'individuals', id: 'f1', before: person('f1', 'Fay'), after: person('f1', 'Faye', 2) }]
		});
		expect(await store.firstTouchedAfter(treeId, targetSeq, [{ entityType: 'person', entityId: 'f1' }])).toEqual({
			summary: 'renamed Fay'
		});

		await store.commit({
			...base(),
			kind: 'undo',
			isUndoable: false,
			revertsChangeId: later!.id,
			ops: [{ table: 'individuals', id: 'f1', before: person('f1', 'Faye', 2), after: person('f1', 'Fay', 3) }]
		});
		expect(await store.firstTouchedAfter(treeId, targetSeq, [{ entityType: 'person', entityId: 'f1' }])).toBeNull();
		expect(target).not.toBeNull();
	});
});
