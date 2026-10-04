import { SQLiteSyncDialect } from 'drizzle-orm/sqlite-core';
import { and, eq, inArray } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { noteAttachments, notes, researchTasks, trees } from '../db/schema';
import { insertCorpus } from '../testing/corpus';
import { createTestDatabase, type TestDatabase } from '../testing/d1';
import { NoteRepository } from './note-repository';
import { chunkByParamLimit } from './param-chunks';
import { TaskRepository } from './task-repository';

let t: TestDatabase;
beforeAll(async () => {
	t = await createTestDatabase();
});
afterAll(async () => {
	await t.dispose();
});

const dialect = new SQLiteSyncDialect();
const EVERYONE = { isRestricted: false, cutoff: '1906-10-01', creatorId: null };
const VIEWER = { isRestricted: true, cutoff: '1906-10-01', creatorId: null as string | null };
const CONTRIBUTOR = { ...VIEWER, creatorId: 'a-contributor' };

interface Plan {
	name: string;
	details: string[];
	returned: number;
	rowsRead: number;
}
async function measure(name: string, statement: { sql: string; params: unknown[] }): Promise<Plan> {
	const plan = await t.d1
		.prepare(`EXPLAIN QUERY PLAN ${statement.sql}`)
		.bind(...statement.params)
		.all<{ detail: string }>();
	const run = await t.d1
		.prepare(statement.sql)
		.bind(...statement.params)
		.run();
	return {
		name,
		details: plan.results.map((r) => r.detail),
		returned: run.results.length,
		rowsRead: run.meta.rows_read
	};
}
const measureSql = (name: string, statement: SQL) => measure(name, dialect.sqlToQuery(statement));

/**
 * A tree's notes and tasks, written straight to the tables: an inline note on one person in three,
 * a shared note on five people each, and tasks about people, facts and nothing.
 */
async function seed(treeId: string, people: string[], facts: string[]) {
	const now = new Date();
	const noteIds = Array.from({ length: Math.max(3, Math.floor(people.length / 30)) }, (_, i) => ({
		id: `${treeId}:note-${i}`,
		treeId,
		xref: `@N${i}@`,
		text: `Shared note ${i} about the family of ${i % 7}`,
		createdAt: now,
		updatedAt: now
	}));
	for (const chunk of chunkByParamLimit(noteIds, 14)) await t.db.insert(notes).values(chunk);
	const attachments = [
		...people.flatMap((id, i) =>
			i % 3 === 0
				? [
						{
							id: `${treeId}:inline-${i}`,
							treeId,
							subjectKind: 'person' as const,
							subjectId: id,
							sortOrder: 0,
							text: `A note on person ${i}`,
							createdAt: now,
							updatedAt: now
						}
					]
				: []
		),
		...noteIds.flatMap((note, n) =>
			Array.from({ length: 5 }, (_, k) => ({
				id: `${treeId}:use-${n}-${k}`,
				treeId,
				subjectKind: 'person' as const,
				subjectId: people[(n * 7 + k) % people.length]!,
				sortOrder: 1,
				noteId: note.id,
				createdAt: now,
				updatedAt: now
			}))
		)
	];
	for (const chunk of chunkByParamLimit(attachments, 14))
		await t.db.insert(noteAttachments).values(chunk);
	const tasks = Array.from({ length: Math.max(6, Math.floor(people.length / 12)) }, (_, i) => ({
		id: `${treeId}:task-${i}`,
		treeId,
		title: `Task ${i}`,
		status: (['open', 'open', 'done', 'dropped'] as const)[i % 4]!,
		assigneeId: i % 5 === 0 ? 'a-member' : null,
		dueDate: i % 3 === 0 ? `2027-0${1 + (i % 9)}-15` : null,
		subjectKind: i % 3 === 0 ? ('person' as const) : i % 3 === 1 ? ('event' as const) : null,
		subjectId:
			i % 3 === 0 ? people[i % people.length]! : i % 3 === 1 ? facts[i % facts.length]! : null,
		createdAt: now,
		updatedAt: now
	}));
	for (let i = 0; i < tasks.length; i += 4)
		await t.db.insert(researchTasks).values(tasks.slice(i, i + 4));
	return {
		noteCount: noteIds.length,
		taskCount: tasks.length,
		attachmentCount: attachments.length
	};
}

describe('the note and task queries, against two trees of different size', () => {
	it('read one tree, use the subject index for a record’s own notes, and answer restricted viewers from named sets', async () => {
		const big = crypto.randomUUID();
		const small = crypto.randomUUID();
		await t.db.insert(trees).values({ id: big, name: 'Big' });
		await t.db.insert(trees).values({ id: small, name: 'Small' });
		await insertCorpus(t.db, big, { prefix: big.slice(0, 8), shouldNameThePeople: true });
		await insertCorpus(t.db, small, {
			prefix: small.slice(0, 8),
			shouldNameThePeople: true,
			seed: 7,
			lineages: 2,
			generations: 7
		});
		const idsOf = async (table: 'individuals' | 'events', treeId: string) =>
			(
				await t.d1
					.prepare(`select id from ${table} where tree_id = ? order by rowid limit 1500`)
					.bind(treeId)
					.all<{ id: string }>()
			).results.map((r) => r.id);
		const seeded = {
			big: await seed(big, await idsOf('individuals', big), await idsOf('events', big)),
			small: await seed(small, await idsOf('individuals', small), await idsOf('events', small))
		};
		expect(seeded.big.attachmentCount).toBeGreaterThan(seeded.small.attachmentCount * 3);

		const noteRepo = new NoteRepository(t.db);
		const taskRepo = new TaskRepository(t.db);
		const page = { offset: 0, limit: 25 };
		const plans: Plan[] = [];
		for (const [size, treeId] of [
			['small', small],
			['big', big]
		] as const) {
			const person = (await idsOf('individuals', treeId))[0]!;
			const noteIds = Array.from({ length: 5 }, (_, i) => `${treeId}:note-${i}`);
			// The record's own notes, as the repository asks for them.
			const own = t.db
				.select()
				.from(noteAttachments)
				.where(
					and(
						eq(noteAttachments.treeId, treeId),
						eq(noteAttachments.subjectKind, 'person'),
						inArray(noteAttachments.subjectId, [person])
					)
				)
				.toSQL();
			plans.push(await measure(`a person's own notes (${size})`, own));
			for (const [label, scope] of [
				['', EVERYONE],
				[', restricted viewer', VIEWER],
				[', restricted contributor', CONTRIBUTOR]
			] as const) {
				plans.push(
					await measureSql(
						`shared notes list, first page${label} (${size})`,
						noteRepo.noteIdsSql(treeId, '', page, scope)
					)
				);
				plans.push(
					await measureSql(
						`use counts of five notes${label} (${size})`,
						noteRepo.useCountsSql(treeId, noteIds, scope)
					)
				);
				plans.push(
					await measureSql(
						`tasks, open, first page${label} (${size})`,
						taskRepo.taskIdsSql(treeId, { status: 'open' }, page, scope)
					)
				);
				plans.push(
					await measureSql(
						`tasks, assigned to me${label} (${size})`,
						taskRepo.taskIdsSql(treeId, { assigneeId: 'a-member' }, page, scope)
					)
				);
				plans.push(
					await measureSql(
						`task counts by status${label} (${size})`,
						taskRepo.statusCountsSql(treeId, {}, scope)
					)
				);
			}
			plans.push(
				await measure(
					`tasks about one person (${size})`,
					t.db
						.select()
						.from(researchTasks)
						.where(
							and(
								eq(researchTasks.treeId, treeId),
								eq(researchTasks.subjectKind, 'person'),
								inArray(researchTasks.subjectId, [person])
							)
						)
						.toSQL()
				)
			);
		}

		const byName = new Map(plans.map((p) => [p.name, p]));
		const read = (name: string) => byName.get(name)!.rowsRead;

		// A record's own notes and tasks come through the index on subject, and cost the same in a
		// big tree as a small one.
		for (const name of ["a person's own notes", 'tasks about one person']) {
			const big = byName.get(`${name} (big)`)!;
			expect(big.details.join(' ')).toMatch(/idx_note_attachment_subject|idx_task_subject/);
			expect(big.rowsRead).toBeLessThanOrEqual(read(`${name} (small)`) + 20);
		}
		// For a viewer who sees everyone the lists never read the people of the tree: they page on
		// their own indexes, so the big tree costs about what its own notes and tasks do.
		for (const name of ['shared notes list, first page', 'tasks, open, first page']) {
			expect(byName.get(`${name} (big)`)!.details.join(' ')).not.toMatch(/individuals|events/);
		}
		expect(read('use counts of five notes (big)')).toBeLessThanOrEqual(
			read('use counts of five notes (small)') + 60
		);
		// A contributor's lists are cut the same way as a viewer's: the creator test only adds a branch.
		expect(
			read('shared notes list, first page, restricted contributor (big)')
		).toBeGreaterThanOrEqual(read('shared notes list, first page, restricted viewer (big)') - 1);
	}, 120_000);
});
