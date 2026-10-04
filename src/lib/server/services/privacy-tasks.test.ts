/**
 * Research tasks follow the people they are about (ADR-015, ADR-029). A task title is its author's
 * own words and can name a living person, so a task about a record the viewer cannot see is hidden
 * with it, title included; an unlinked task is every member's. A hidden task answers as a missing
 * one does, and the SQL that pages and counts is held to the same answers as the row filter.
 */

import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { events, individuals, notes, researchTasks, sources } from '../db/schema';
import { NotFoundError } from '../domain/errors';
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
import { maskRows, opsTouchPrivate } from '../domain/privacy-mask';
import { ChangeStore } from '../repositories/change-store';
import { TaskRepository } from '../repositories/task-repository';
import { livingCutoff } from '../domain/living-state';
import { PersonPageService } from './person-page-service';
import { TaskReadService } from './task-read-service';
import { TaskService } from './task-service';

const FIXTURE = `0 HEAD
0 @N1@ NOTE Diary of Livia, used only by her
0 @N2@ NOTE A story about Grandar
0 @S1@ SOUR
1 TITL Birth certificate of Livia Aliveson
0 @S2@ SOUR
1 TITL Census 1851
0 @I1@ INDI
1 NAME Grandar /Oldman/
1 NOTE @N2@
1 BIRT
2 DATE 1850
2 SOUR @S2@
3 PAGE 4
0 @I2@ INDI
1 NAME Livia /Aliveson/
1 NOTE @N1@
1 NOTE @N2@
1 BIRT
2 DATE 1985
2 SOUR @S1@
3 PAGE 7
1 FAMS @F1@
0 @F1@ FAM
1 HUSB @I1@
1 WIFE @I2@
1 MARR
2 DATE 1990
0 TRLR`;

const SECRETS = ['Livia', 'Aliveson'];
const leaks = (value: unknown) => SECRETS.filter((s) => JSON.stringify(value).includes(s));

let t: TestDatabase;
let treeId: string;
const actors = {} as Record<TreeRole, TestActor>;
const ids = {} as Record<string, string>;
const tasks = {} as Record<string, string>;

const NOW = new Date('2026-10-01T12:00:00Z');
const reads = () => new TaskReadService(t.db, () => NOW);
const service = () => new TaskService(t.db);

beforeAll(async () => {
	t = await createTestDatabase();
	actors.owner = await createTestUser(t.db, 'owner');
	treeId = await createTestTree(t.db, actors.owner);
	for (const role of ['editor', 'contributor', 'viewer'] as const) {
		actors[role] = await createTestUser(t.db, role);
		await addTestMember(t.db, treeId, actors[role], role);
	}
	await importGedcomToDb(t.d1, treeId, FIXTURE, 'Tasks privacy');
	for (const row of await t.db.select().from(individuals).where(eq(individuals.treeId, treeId)))
		ids[row.xrefId!] = row.id;
	for (const row of await t.db.select().from(sources).where(eq(sources.treeId, treeId)))
		ids[row.xref!] = row.id;
	for (const row of await t.db.select().from(notes).where(eq(notes.treeId, treeId)))
		ids[row.xref!] = row.id;
	for (const row of await t.db.select().from(events).where(eq(events.treeId, treeId)))
		ids[`${row.entityId.split(':')[1]}:${row.type}`] = row.id;
	ids['F1'] = `${treeId}:@F1@`;

	const make = async (
		key: string,
		title: string,
		subject?: { kind: 'person' | 'union' | 'event' | 'source' | 'note'; id: string }
	) => {
		tasks[key] = (
			await service().createTask(treeId, { task: { title }, subject }, actors.editor.context)
		).taskId;
	};
	await make('unlinked', 'Check the surname spellings');
	await make('grandar', 'Find the burial of Grandar', { kind: 'person', id: ids['@I1@'] });
	await make('grandar-birth', 'Confirm the year of birth', { kind: 'event', id: ids['@I1@:BIRT'] });
	await make('livia', 'Ask Livia about her birth certificate', { kind: 'person', id: ids['@I2@'] });
	await make('livia-birth', 'Livia’s birth place', { kind: 'event', id: ids['@I2@:BIRT'] });
	await make('union', 'Marriage record of Livia and Grandar', { kind: 'union', id: ids['F1'] });
	await make('source-livia', 'Photocopy the certificate', { kind: 'source', id: ids['@S1@'] });
	await make('source-census', 'Find a better scan', { kind: 'source', id: ids['@S2@'] });
	await make('note-livia', 'Rewrite the diary note', { kind: 'note', id: ids['@N1@'] });
	await make('note-shared', 'Tidy the story', { kind: 'note', id: ids['@N2@'] });
}, 60_000);
afterAll(async () => {
	await t.dispose();
});

const VISIBLE_TO_RESTRICTED = [
	'unlinked',
	'grandar',
	'grandar-birth',
	'source-census',
	'note-shared'
];

describe('reading tasks as a contributor', () => {
	const ctx = () => actors.contributor.context;

	it('lists only unlinked tasks and those about records they can see, titles included', async () => {
		const page = await reads().listTasks(treeId, { status: 'all' }, ctx());
		expect(page.items.map((i) => i.id).sort()).toEqual(
			VISIBLE_TO_RESTRICTED.map((k) => tasks[k]).sort()
		);
		expect(leaks(page.items)).toEqual([]);
		// The counts are over the same set, so a count never says a hidden task is there.
		expect(page.counts).toEqual({ open: VISIBLE_TO_RESTRICTED.length, done: 0, dropped: 0 });
		expect(leaks(page.members)).toEqual([]);
	});

	it('answers a hidden task as a task that is not there', async () => {
		const hidden = await reads()
			.getTask(treeId, tasks['livia'], ctx())
			.catch((e) => e);
		const missing = await reads()
			.getTask(treeId, 'no-such-task', ctx())
			.catch((e) => e);
		expect(hidden).toBeInstanceOf(NotFoundError);
		expect(hidden.constructor).toBe(missing.constructor);
		expect(hidden.message.replace(tasks['livia'], 'ID')).toBe(
			missing.message.replace('no-such-task', 'ID')
		);
		expect(leaks(hidden.message)).toEqual([]);
	});

	it('is shown a visible person’s tasks on their page, and none of a private person’s', async () => {
		const people = new PersonPageService(t.db, () => NOW);
		const grandar = await people.getPerson(treeId, ids['@I1@'], ctx());
		expect(grandar.tasks.items.map((i) => i.title).sort()).toEqual([
			'Confirm the year of birth',
			'Find the burial of Grandar'
		]);
		expect(leaks(grandar.tasks)).toEqual([]);
		const hidden = await people.getPerson(treeId, ids['@I2@'], ctx()).catch((e) => e);
		expect(hidden).toBeInstanceOf(NotFoundError);
	});

	it('finds no task through a filter on a record it cannot see', async () => {
		const page = await reads().listTasks(
			treeId,
			{ status: 'all', subject: { kind: 'person', id: ids['@I2@'] } },
			ctx()
		);
		expect(page.items).toEqual([]);
		expect(page.counts).toEqual({ open: 0, done: 0, dropped: 0 });
	});
});

describe('a contributor writing tasks', () => {
	const ctx = () => actors.contributor.context;

	it('cannot make a task about a private person’s record, and is answered as for one that does not exist', async () => {
		const hidden = await service()
			.createTask(
				treeId,
				{ task: { title: 'x' }, subject: { kind: 'event', id: ids['@I2@:BIRT'] } },
				ctx()
			)
			.catch((e) => e);
		const missing = await service()
			.createTask(
				treeId,
				{ task: { title: 'x' }, subject: { kind: 'event', id: 'no-such-fact' } },
				ctx()
			)
			.catch((e) => e);
		expect(hidden.constructor).toBe(missing.constructor);
		expect(hidden.message.replace(ids['@I2@:BIRT'], 'ID')).toBe(
			missing.message.replace('no-such-fact', 'ID')
		);
		expect(leaks(hidden.message)).toEqual([]);
	});

	it('is told nothing of a hidden task when it tries to edit or delete one', async () => {
		const row = (await t.db
			.select()
			.from(researchTasks)
			.where(eq(researchTasks.id, tasks['livia']))
			.get())!;
		for (const attempt of [
			service().updateTask(treeId, tasks['livia'], { title: 'x' }, row.version, ctx()),
			service().deleteTask(treeId, tasks['livia'], row.version, ctx())
		]) {
			const error = await attempt.catch((e) => e);
			expect(['UNAUTHORIZED', 'NOT_FOUND']).toContain(error.code);
			expect(leaks(error.message)).toEqual([]);
		}
	});

	it('can make a task about a record it can see, and sees the one it made', async () => {
		const made = await service().createTask(
			treeId,
			{ task: { title: 'My own task' }, subject: { kind: 'person', id: ids['@I1@'] } },
			ctx()
		);
		const page = await reads().listTasks(treeId, { status: 'all' }, ctx());
		expect(page.items.map((i) => i.id)).toContain(made.taskId);
	});
});

describe('reading tasks as an editor', () => {
	it('sees every task', async () => {
		const page = await reads().listTasks(
			treeId,
			{ status: 'all', limit: 100 },
			actors.editor.context
		);
		expect(Object.values(tasks).every((id) => page.items.some((i) => i.id === id))).toBe(true);
		expect(page.items.find((i) => i.id === tasks['livia'])?.subject?.label).toBe('Livia Aliveson');
		expect(page.items.find((i) => i.id === tasks['source-livia'])?.subject?.label).toContain(
			'Birth certificate of Livia Aliveson'
		);
	});
});

describe('the SQL and the row filters agree on what tasks a viewer sees', () => {
	it.each(['contributor', 'viewer'] as const)('for a %s', async (role) => {
		const rows = await new ChangeStore(t.db).loadRows(treeId);
		const scope = {
			isRestricted: true,
			cutoff: livingCutoff(NOW, 110),
			creatorId: role === 'contributor' ? actors.contributor.userId : null
		};
		const masked = maskRows(rows, scope.cutoff, false, scope.creatorId).rows;
		const repo = new TaskRepository(t.db);
		const sqlIds = (await repo.taskIds(treeId, {}, { offset: 0, limit: 100 }, scope)).ids.sort();
		expect(sqlIds).toEqual(masked.researchTasks.map((task) => task.id).sort());
		// Every kind of subject is in play: nothing, and a person, fact, partnership, source and note.
		expect(new Set(rows.researchTasks.map((task) => task.subjectKind))).toEqual(
			new Set([null, 'person', 'event', 'union', 'source', 'note'])
		);
	});

	it('also refuses a change that touches a task about a record it cannot see', async () => {
		const rows = await new ChangeStore(t.db).loadRows(treeId);
		const livia = rows.researchTasks.find((task) => task.id === tasks['livia'])!;
		const op = {
			table: 'research_tasks' as const,
			id: livia.id,
			before: livia,
			after: { ...livia, title: 'changed' }
		};
		expect(opsTouchPrivate([op], rows, livingCutoff(NOW, 110), actors.contributor.userId)).toBe(
			true
		);
		const open = rows.researchTasks.find((task) => task.id === tasks['unlinked'])!;
		expect(
			opsTouchPrivate(
				[
					{
						table: 'research_tasks',
						id: open.id,
						before: open,
						after: { ...open, title: 'changed' }
					}
				],
				rows,
				livingCutoff(NOW, 110),
				actors.contributor.userId
			)
		).toBe(false);
	});
});
