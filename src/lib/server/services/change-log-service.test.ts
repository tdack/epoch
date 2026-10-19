import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { changeLog } from '../db/schema';
import { UnauthorizedError } from '../domain/errors';
import { AUDIT_PAGE_SIZE } from '../../shared/change-audit';
import {
	addTestMember,
	createTestDatabase,
	createTestTree,
	createTestUser,
	type TestActor,
	type TestDatabase
} from '../testing/d1';
import { ChangeLogService } from './change-log-service';
import { PersonService } from './person-service';

let t: TestDatabase;
let owner: TestActor;
let editor: TestActor;
let otherEditor: TestActor;
let manager: TestActor;
let viewer: TestActor;
let treeId: string;

beforeAll(async () => {
	t = await createTestDatabase();
	[owner, editor, otherEditor, manager, viewer] = await Promise.all(
		['owner', 'editor', 'other', 'manager', 'viewer'].map((label) => createTestUser(t.db, label))
	);
	treeId = await createTestTree(t.db, owner);
	await addTestMember(t.db, treeId, editor, 'editor');
	await addTestMember(t.db, treeId, otherEditor, 'editor');
	await addTestMember(t.db, treeId, manager, 'manager');
	await addTestMember(t.db, treeId, viewer, 'viewer');
}, 60_000);
afterAll(async () => {
	await t.dispose();
});

const log = () => new ChangeLogService(t.db);
const people = () => new PersonService(t.db);

/** A new person made by `by`, with the id of the change that made them. */
async function addPerson(name: string, by: TestActor = editor, inTree = treeId) {
	const { individual, change } = await people().create(inTree, { givenName: name }, by.context);
	return { personId: individual.id, changeId: change!.id };
}

describe('undoChange', () => {
	it('undoes your own change that is not the latest', async () => {
		const first = await addPerson('Firsta');
		await addPerson('Seconda');
		const result = await log().undoChange(treeId, first.changeId, editor.context);
		expect(result.undone.id).toBe(first.changeId);
		const audit = await log().audit(treeId, editor.context, { recordId: first.personId });
		expect(audit.entries.map((e) => [e.isUndo, e.isUndone])).toEqual([
			[true, false],
			[false, true]
		]);
	});

	it("refuses an editor undoing someone else's change, and lets a manager do it", async () => {
		const theirs = await addPerson('Theirs', otherEditor);
		await expect(log().undoChange(treeId, theirs.changeId, editor.context)).rejects.toMatchObject({
			details: { reason: 'not_yours' },
			status: 403
		});
		await expect(log().undoChange(treeId, theirs.changeId, manager.context)).resolves.toBeTruthy();
	});

	it('refuses a change that was already undone', async () => {
		const made = await addPerson('Twice');
		await log().undoChange(treeId, made.changeId, editor.context);
		await expect(log().undoChange(treeId, made.changeId, editor.context)).rejects.toMatchObject({
			details: { reason: 'already_undone' }
		});
	});

	it('refuses when a later change wrote the same records', async () => {
		const made = await addPerson('Touched');
		await people().update(treeId, made.personId, 1, { surname: 'Later' }, editor.context);
		await expect(log().undoChange(treeId, made.changeId, editor.context)).rejects.toMatchObject({
			details: { reason: 'touched_later' }
		});
	});

	it('does not undo an undo', async () => {
		const made = await addPerson('Final');
		const undone = await log().undoChange(treeId, made.changeId, editor.context);
		await expect(log().undoChange(treeId, undone.change!.id, editor.context)).rejects.toMatchObject(
			{ details: { reason: 'not_undoable' } }
		);
	});

	it("does not find another tree's change", async () => {
		const elsewhere = await createTestTree(t.db, owner);
		const foreign = await addPerson('Foreign', owner, elsewhere);
		await expect(log().undoChange(treeId, foreign.changeId, owner.context)).rejects.toMatchObject({
			status: 404
		});
	});

	it('undoLast still reverses the latest change of the caller', async () => {
		const made = await addPerson('Latest');
		expect((await log().undoLast(treeId, editor.context)).undone.id).toBe(made.changeId);
	});
});

describe('audit', () => {
	it('is read only by roles that see every record', async () => {
		await expect(log().audit(treeId, viewer.context)).rejects.toBeInstanceOf(UnauthorizedError);
	});

	it('pages newest first with a total, clamps the page, and filters to one record', async () => {
		const tree = await createTestTree(t.db, owner);
		await addTestMember(t.db, tree, editor, 'editor');
		const made = [];
		for (let i = 0; i < AUDIT_PAGE_SIZE + 1; i++) made.push(await addPerson(`P${i}`, editor, tree));

		const first = await log().audit(tree, editor.context);
		expect(first).toMatchObject({ page: 1, pageCount: 2, total: AUDIT_PAGE_SIZE + 1 });
		expect(first.entries).toHaveLength(AUDIT_PAGE_SIZE);
		expect(first.entries[0]!.id).toBe(made.at(-1)!.changeId);

		const second = await log().audit(tree, editor.context, { page: 2 });
		expect(second.entries.map((e) => e.id)).toEqual([made[0]!.changeId]);

		// Past the end is the last page; below one is the first.
		expect((await log().audit(tree, editor.context, { page: 99 })).page).toBe(2);
		expect((await log().audit(tree, editor.context, { page: -3 })).page).toBe(1);

		const one = await log().audit(tree, editor.context, { recordId: made[3]!.personId });
		expect(one).toMatchObject({ total: 1, pageCount: 1 });
		expect(one.entries.map((e) => e.id)).toEqual([made[3]!.changeId]);
		expect(one.entries[0]!.records.some((r) => r.isLinkable && r.entityType === 'person')).toBe(
			true
		);
	});

	it('filters by actor and lists the actors in the log', async () => {
		const tree = await createTestTree(t.db, owner);
		await addTestMember(t.db, tree, editor, 'editor');
		await addTestMember(t.db, tree, otherEditor, 'editor');
		const mine = await addPerson('Mine', editor, tree);
		await addPerson('Theirs', otherEditor, tree);
		const page = await log().audit(tree, editor.context, { actorId: editor.userId });
		expect(page.entries.map((e) => e.id)).toEqual([mine.changeId]);
		expect(page.total).toBe(1);
		expect(page.actors.map((a) => a.name)).toEqual(['editor', 'other']);
	});

	it('takes whole UTC days, both ends included', async () => {
		const tree = await createTestTree(t.db, owner);
		await addTestMember(t.db, tree, editor, 'editor');
		const stamp = (iso: string) =>
			t.db
				.update(changeLog)
				.set({ createdAt: new Date(iso) })
				.where(eq(changeLog.id, ids.get(iso)!));
		const ids = new Map<string, string>();
		for (const iso of [
			'2026-03-01T23:59:59.999Z',
			'2026-03-02T00:00:00.000Z',
			'2026-03-03T23:59:59.999Z',
			'2026-03-04T00:00:00.000Z'
		]) {
			ids.set(iso, (await addPerson(iso, editor, tree)).changeId);
			await stamp(iso);
		}
		const between = async (from: string | null, to: string | null) =>
			(await log().audit(tree, editor.context, { from, to })).entries
				.map((e) => e.summary.replace('Added ', ''))
				.sort();
		expect(await between('2026-03-02', '2026-03-03')).toEqual([
			'2026-03-02T00:00:00.000Z',
			'2026-03-03T23:59:59.999Z'
		]);
		expect(await between('2026-03-04', null)).toEqual(['2026-03-04T00:00:00.000Z']);
		expect(await between(null, '2026-03-01')).toEqual(['2026-03-01T23:59:59.999Z']);
		expect(await between('2026-03-05', null)).toEqual([]);
	});

	it("reads the days in the reader's zone: 23:30 UTC on the 19th is the 20th in Adelaide", async () => {
		const tree = await createTestTree(t.db, owner);
		await addTestMember(t.db, tree, editor, 'editor');
		const made = await addPerson('Late', editor, tree);
		await t.db
			.update(changeLog)
			.set({ createdAt: new Date('2026-01-19T23:30:00Z') })
			.where(eq(changeLog.id, made.changeId));
		const on = async (day: string, tz?: string) =>
			(await log().audit(tree, editor.context, { from: day, to: day, tz })).total;
		expect(await on('2026-01-20', 'Australia/Adelaide')).toBe(1);
		expect(await on('2026-01-19', 'Australia/Adelaide')).toBe(0);
		expect(await on('2026-01-19')).toBe(1);
		expect(await on('2026-01-19', 'Not/AZone')).toBe(1);
		const page = await log().audit(tree, editor.context, { tz: 'Australia/Adelaide' });
		expect(page.timeZone).toBe('Australia/Adelaide');
		expect((await log().audit(tree, editor.context, { tz: 'junk' })).timeZone).toBe('UTC');
	});

	it('combines the filters and counts under them', async () => {
		const tree = await createTestTree(t.db, owner);
		await addTestMember(t.db, tree, editor, 'editor');
		await addTestMember(t.db, tree, otherEditor, 'editor');
		const mine = await addPerson('Mine', editor, tree);
		await addPerson('Theirs', otherEditor, tree);
		const none = await log().audit(tree, editor.context, {
			actorId: editor.userId,
			recordId: mine.personId,
			from: '2000-01-01',
			to: '2000-01-02'
		});
		expect(none).toMatchObject({ total: 0, entries: [] });
		const some = await log().audit(tree, editor.context, {
			actorId: editor.userId,
			recordId: mine.personId,
			from: '2000-01-01'
		});
		expect(some.total).toBe(1);
	});

	it('says who undid a change and whether the viewer may undo it', async () => {
		const made = await addPerson('Named');
		await log().undoChange(treeId, made.changeId, manager.context);
		const { entries } = await log().audit(treeId, editor.context, { recordId: made.personId });
		const original = entries.find((e) => e.id === made.changeId)!;
		expect(original).toMatchObject({ isUndone: true, undoneByName: 'manager', canUndo: false });
		const added = await addPerson('Open', otherEditor);
		const open = (await log().audit(treeId, editor.context, { recordId: added.personId }))
			.entries[0]!;
		expect(open.canUndo).toBe(false);
		const asManager = (await log().audit(treeId, manager.context, { recordId: added.personId }))
			.entries[0]!;
		expect(asManager.canUndo).toBe(true);
	});
});
