import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { researchTasks } from '../db/schema';
import { ConcurrencyConflictError, UnauthorizedError, ValidationError } from '../domain/errors';
import { buildGedcom551String } from '../gedcom/serializer';
import { getTreeExportData, importGedcomToDb } from '../testing/gedcom';
import {
	addTestMember,
	createTestDatabase,
	createTestTree,
	createTestUser,
	type TestDatabase
} from '../testing/d1';
import { ChangeLogService } from './change-log-service';
import { ChangeStore } from '../repositories/change-store';
import { FactService } from './fact-service';
import { MemberService } from './member-service';
import { NoteService } from './note-service';
import { PersonMergeService } from './person-merge-service';
import { PersonService } from './person-service';
import { RelationshipService } from './relationship-service';
import { TaskReadService } from './task-read-service';
import { TaskService } from './task-service';

let t: TestDatabase;
beforeAll(async () => {
	t = await createTestDatabase();
});
afterAll(async () => {
	await t.dispose();
});

const blank = { dateText: null, place: null, value: null, cause: null, age: null, notes: null };
const taskRow = (id: string) =>
	t.db.select().from(researchTasks).where(eq(researchTasks.id, id)).get();

async function setup() {
	const actor = await createTestUser(t.db);
	const treeId = await createTestTree(t.db, actor);
	const ctx = actor.context;
	const people = new PersonService(t.db);
	const person = (await people.create(treeId, { givenName: 'Wren', surname: 'Ash' }, ctx))
		.individual;
	const birth = await new FactService(t.db).create(
		treeId,
		person.id,
		{ ...blank, type: 'BIRT', dateText: '1900' },
		ctx
	);
	return {
		actor,
		treeId,
		ctx,
		person,
		people,
		birthId: birth.factId,
		service: new TaskService(t.db),
		reads: new TaskReadService(t.db),
		log: new ChangeLogService(t.db)
	};
}

describe('a research task through the mutation runner', () => {
	it('is made, edited, completed, reopened and dropped, and undo restores each step', async () => {
		const { treeId, ctx, service, reads, log } = await setup();
		const made = await service.createTask(
			treeId,
			{
				task: {
					title: 'Find the 1901 census',
					details: 'Try the county archive',
					dueDate: '2027-03-31'
				}
			},
			ctx
		);
		expect(made.change?.summary).toBe('Added the task “Find the 1901 census”');
		expect((await taskRow(made.taskId))!).toMatchObject({
			title: 'Find the 1901 census',
			status: 'open',
			dueDate: '2027-03-31',
			subjectKind: null
		});

		const first = (await taskRow(made.taskId))!;
		const done = await service.updateTask(
			treeId,
			made.taskId,
			{ status: 'done' },
			first.version,
			ctx
		);
		expect(done.change?.summary).toBe('Completed the task “Find the 1901 census”');
		expect((await taskRow(made.taskId))!.status).toBe('done');
		await log.undoLast(treeId, ctx);
		expect((await taskRow(made.taskId))!.status).toBe('open');

		const open = (await taskRow(made.taskId))!;
		await service.updateTask(
			treeId,
			made.taskId,
			{ status: 'dropped', title: 'Find the census' },
			open.version,
			ctx
		);
		expect((await taskRow(made.taskId))!).toMatchObject({
			status: 'dropped',
			title: 'Find the census'
		});

		const listed = await reads.listTasks(treeId, { status: 'all' }, ctx);
		expect(listed.items.map((i) => i.status)).toEqual(['dropped']);
		expect(listed.counts).toEqual({ open: 0, done: 0, dropped: 1 });
		expect((await reads.listTasks(treeId, {}, ctx)).items).toEqual([]);
	});

	it('answers a stale edit with STALE_VERSION and the current values', async () => {
		const { treeId, ctx, service } = await setup();
		const made = await service.createTask(treeId, { task: { title: 'One' } }, ctx);
		const row = (await taskRow(made.taskId))!;
		await service.updateTask(treeId, made.taskId, { title: 'Two' }, row.version, ctx);
		const error = await service
			.updateTask(treeId, made.taskId, { title: 'Three' }, row.version, ctx)
			.catch((e) => e);
		expect(error).toBeInstanceOf(ConcurrencyConflictError);
		expect(error.details).toMatchObject({
			reason: 'STALE_VERSION',
			entity: 'task',
			current: { title: 'Two' }
		});
	});

	it('refuses an empty title, a bad date and a record that is not there', async () => {
		const { treeId, ctx, service } = await setup();
		await expect(service.createTask(treeId, { task: { title: '  ' } }, ctx)).rejects.toBeInstanceOf(
			ValidationError
		);
		await expect(
			service.createTask(treeId, { task: { title: 'x', dueDate: '2027-02-30' } }, ctx)
		).rejects.toBeInstanceOf(ValidationError);
		await expect(
			service.createTask(
				treeId,
				{ task: { title: 'x' }, subject: { kind: 'person', id: 'nope' } },
				ctx
			)
		).rejects.toMatchObject({ code: 'NOT_FOUND' });
	});

	it('can be about a person, a fact, a partnership, a source or a shared note, and a finding', async () => {
		const { treeId, ctx, service, person, birthId } = await setup();
		const note = await new NoteService(t.db).createNote(treeId, { text: 'a shared note' }, ctx);
		const made = [
			await service.createTask(
				treeId,
				{ task: { title: 'about the person' }, subject: { kind: 'person', id: person.id } },
				ctx
			),
			await service.createTask(
				treeId,
				{
					task: { title: 'about the birth' },
					subject: { kind: 'event', id: birthId },
					findingKey: 'unsourced_key_fact:x'
				},
				ctx
			),
			await service.createTask(
				treeId,
				{ task: { title: 'about the note' }, subject: { kind: 'note', id: note.noteId } },
				ctx
			)
		];
		const page = await reads(treeId, ctx);
		const byTitle = Object.fromEntries(page.items.map((i) => [i.title, i]));
		expect(byTitle['about the person'].subject).toMatchObject({
			kind: 'person',
			label: 'Wren Ash',
			personId: person.id
		});
		expect(byTitle['about the birth'].subject?.label).toBe('the birth of Wren Ash');
		expect(byTitle['about the birth'].findingKey).toBe('unsourced_key_fact:x');
		expect(byTitle['about the note'].subject?.noteId).toBe(note.noteId);
		expect(made).toHaveLength(3);
	});

	async function reads(treeId: string, ctx: Awaited<ReturnType<typeof setup>>['ctx']) {
		return new TaskReadService(t.db).listTasks(treeId, { status: 'all' }, ctx);
	}
});

describe('assignees', () => {
	it('must be members of the tree, and a member who leaves leaves their tasks unassigned', async () => {
		const { treeId, ctx, service, reads } = await setup();
		const member = await createTestUser(t.db, 'member');
		await addTestMember(t.db, treeId, member, 'editor');
		const stranger = await createTestUser(t.db, 'stranger');

		await expect(
			service.createTask(treeId, { task: { title: 'x', assigneeId: stranger.userId } }, ctx)
		).rejects.toBeInstanceOf(ValidationError);

		const made = await service.createTask(
			treeId,
			{ task: { title: 'for the member', assigneeId: member.userId } },
			ctx
		);
		expect((await reads.listTasks(treeId, {}, ctx)).items[0].assignee?.id).toBe(member.userId);
		expect((await reads.listTasks(treeId, { isMine: true }, ctx)).items).toEqual([]);
		expect(
			(await reads.listTasks(treeId, { isMine: true }, member.context)).items.map((i) => i.id)
		).toEqual([made.taskId]);

		const membership = (await new MemberService(t.db).list(treeId, ctx)).members.find(
			(m) => m.userId === member.userId
		)!;
		await new MemberService(t.db).remove(treeId, member.userId, membership.version, ctx);
		const kept = (await taskRow(made.taskId))!;
		expect(kept.assigneeId).toBeNull();
		expect(kept.title).toBe('for the member');
		expect((await reads.listTasks(treeId, {}, ctx)).items[0].assignee).toBeNull();
	});
});

describe('who may write tasks', () => {
	it('lets a contributor make tasks and edit their own, an editor edit any, and a viewer none', async () => {
		const { treeId, ctx, service } = await setup();
		const contributor = await createTestUser(t.db, 'contributor');
		await addTestMember(t.db, treeId, contributor, 'contributor');
		const editor = await createTestUser(t.db, 'editor');
		await addTestMember(t.db, treeId, editor, 'editor');
		const viewer = await createTestUser(t.db, 'viewer');
		await addTestMember(t.db, treeId, viewer, 'viewer');

		await expect(
			service.createTask(treeId, { task: { title: 'x' } }, viewer.context)
		).rejects.toBeInstanceOf(UnauthorizedError);

		const mine = await service.createTask(treeId, { task: { title: 'mine' } }, contributor.context);
		const others = await service.createTask(treeId, { task: { title: 'theirs' } }, ctx);
		const own = (await taskRow(mine.taskId))!;
		const foreign = (await taskRow(others.taskId))!;

		await service.updateTask(
			treeId,
			mine.taskId,
			{ status: 'done' },
			own.version,
			contributor.context
		);
		expect((await taskRow(mine.taskId))!.status).toBe('done');
		await expect(
			service.updateTask(
				treeId,
				others.taskId,
				{ status: 'done' },
				foreign.version,
				contributor.context
			)
		).rejects.toBeInstanceOf(UnauthorizedError);
		await expect(
			service.deleteTask(treeId, mine.taskId, undefined, contributor.context)
		).rejects.toBeInstanceOf(UnauthorizedError);

		await service.updateTask(
			treeId,
			others.taskId,
			{ status: 'done' },
			foreign.version,
			editor.context
		);
		expect((await taskRow(others.taskId))!.status).toBe('done');
		await service.deleteTask(treeId, others.taskId, undefined, editor.context);
		expect(await taskRow(others.taskId)).toBeUndefined();
	});
});

describe('a task follows the record it is about', () => {
	it('moves with a person merge, and with the fact that is kept', async () => {
		const actor = await createTestUser(t.db);
		const treeId = await createTestTree(t.db, actor);
		const file = `0 HEAD
1 GEDC
2 VERS 5.5.1
0 @I1@ INDI
1 NAME Ann /Ash/
1 BIRT
2 DATE 1900
0 @I2@ INDI
1 NAME Ann /Ash/
1 BIRT
2 DATE 1900
0 TRLR`;
		await importGedcomToDb(t.d1, treeId, file, 'People', 'merge');
		const rows = await new ChangeStore(t.db).loadRows(treeId);
		const [survivor, merged] = [`${treeId}:@I1@`, `${treeId}:@I2@`];
		const birthOf = (id: string) =>
			rows.events.find((e) => e.entityId === id && e.type === 'BIRT')!.id;
		const service = new TaskService(t.db);
		const onPerson = await service.createTask(
			treeId,
			{ task: { title: 'person' }, subject: { kind: 'person', id: merged } },
			actor.context
		);
		const onBirth = await service.createTask(
			treeId,
			{ task: { title: 'birth' }, subject: { kind: 'event', id: birthOf(merged) } },
			actor.context
		);

		await new PersonMergeService(t.db).merge(
			treeId,
			{ survivorId: survivor, mergedId: merged },
			actor.context
		);
		expect((await taskRow(onPerson.taskId))!).toMatchObject({
			subjectKind: 'person',
			subjectId: survivor
		});
		expect((await taskRow(onBirth.taskId))!).toMatchObject({
			subjectKind: 'event',
			subjectId: birthOf(survivor)
		});

		await new ChangeLogService(t.db).undoLast(treeId, actor.context);
		expect((await taskRow(onPerson.taskId))!.subjectId).toBe(merged);
		expect((await taskRow(onBirth.taskId))!.subjectId).toBe(birthOf(merged));
	});

	it('moves with a partnership merge: to the survivor, and a fact it did not keep to the partnership', async () => {
		const actor = await createTestUser(t.db);
		const treeId = await createTestTree(t.db, actor);
		const file = `0 HEAD
1 GEDC
2 VERS 5.5.1
0 @I1@ INDI
1 NAME Xan /Ash/
0 @I2@ INDI
1 NAME Yve /Birch/
0 @F1@ FAM
1 HUSB @I1@
1 WIFE @I2@
1 MARR
2 DATE 1900
0 @F2@ FAM
1 HUSB @I1@
1 WIFE @I2@
1 MARR
2 DATE 1905
0 TRLR`;
		await importGedcomToDb(t.d1, treeId, file, 'Unions', 'merge');
		const [f1, f2] = [`${treeId}:@F1@`, `${treeId}:@F2@`];
		const rows = await new ChangeStore(t.db).loadRows(treeId);
		const marriageOf = (id: string) =>
			rows.events.find((e) => e.entityId === id && e.type === 'MARR')!.id;
		const service = new TaskService(t.db);
		const onUnion = await service.createTask(
			treeId,
			{ task: { title: 'union' }, subject: { kind: 'union', id: f2 } },
			actor.context
		);
		const onLost = await service.createTask(
			treeId,
			{ task: { title: 'lost marriage' }, subject: { kind: 'event', id: marriageOf(f2) } },
			actor.context
		);
		await new RelationshipService(t.db).mergeUnions(
			treeId,
			{
				kind: 'merge_unions',
				survivorId: f1,
				mergedIds: [f2],
				keep: { events: { MARR: f1 } }
			},
			actor.context
		);
		expect((await taskRow(onUnion.taskId))!).toMatchObject({ subjectKind: 'union', subjectId: f1 });
		expect((await taskRow(onLost.taskId))!).toMatchObject({ subjectKind: 'union', subjectId: f1 });
	});

	it('is kept with its link cleared when the record is deleted, says what it was about, and undo restores the link', async () => {
		const { treeId, ctx, service, person, birthId, people, reads, log } = await setup();
		const onPerson = await service.createTask(
			treeId,
			{ task: { title: 'check the person record' }, subject: { kind: 'person', id: person.id } },
			ctx
		);
		const onBirth = await service.createTask(
			treeId,
			{ task: { title: 'about the birth' }, subject: { kind: 'event', id: birthId } },
			ctx
		);

		await people.remove(treeId, person.id, ctx);
		const kept = await reads.listTasks(treeId, { status: 'all' }, ctx);
		expect(kept.items.map((i) => [i.title, i.subject, i.clearedLinkKind]).sort()).toEqual([
			['about the birth', null, 'event'],
			['check the person record', null, 'person']
		]);
		expect((await taskRow(onPerson.taskId))!).toMatchObject({
			subjectKind: null,
			subjectId: null,
			linkClearedKind: 'person'
		});
		// What it says names nobody: the person may have been private, and an unlinked task is everyone's.
		expect(JSON.stringify(kept.items)).not.toContain('Wren');

		await log.undoLast(treeId, ctx);
		expect((await taskRow(onPerson.taskId))!).toMatchObject({
			subjectKind: 'person',
			subjectId: person.id,
			linkClearedKind: null
		});
		expect((await taskRow(onBirth.taskId))!.subjectId).toBe(birthId);
	});

	it('is kept when a source or a shared note it is about is deleted', async () => {
		const { treeId, ctx, service } = await setup();
		const { EvidenceService } = await import('./evidence-service');
		const source = await new EvidenceService(t.db).createSource(treeId, { title: 'A source' }, ctx);
		const note = await new NoteService(t.db).createNote(treeId, { text: 'A note' }, ctx);
		const a = await service.createTask(
			treeId,
			{ task: { title: 'a' }, subject: { kind: 'source', id: source.sourceId } },
			ctx
		);
		const b = await service.createTask(
			treeId,
			{ task: { title: 'b' }, subject: { kind: 'note', id: note.noteId } },
			ctx
		);
		await new EvidenceService(t.db).deleteSource(treeId, source.sourceId, {}, ctx);
		await new NoteService(t.db).deleteSharedNote(treeId, note.noteId, {}, ctx);
		expect((await taskRow(a.taskId))!).toMatchObject({
			subjectKind: null,
			linkClearedKind: 'source'
		});
		expect((await taskRow(b.taskId))!).toMatchObject({
			subjectKind: null,
			linkClearedKind: 'note'
		});
	});
});

describe('tasks are not part of a file', () => {
	it('are not exported, and a custom to-do tag in a file stays retained verbatim', async () => {
		const { treeId, ctx, service } = await setup();
		await service.createTask(treeId, { task: { title: 'A very secret title' } }, ctx);
		const file = `0 HEAD
1 GEDC
2 VERS 5.5.1
0 @I9@ INDI
1 NAME Todo /Person/
1 _TODO Find the marriage
2 DATE 2020
0 TRLR`;
		await importGedcomToDb(t.d1, treeId, file, 'Todo', 'merge');
		const text = buildGedcom551String(await getTreeExportData(t.d1, treeId));
		expect(text).not.toContain('A very secret title');
		expect(text).toContain('1 _TODO Find the marriage\r\n2 DATE 2020');
		expect(
			(
				await t.db
					.select()
					.from(researchTasks)
					.where(sql`tree_id = ${treeId}`)
					.all()
			).map((row) => row.title)
		).toEqual(['A very secret title']);
	});
});
