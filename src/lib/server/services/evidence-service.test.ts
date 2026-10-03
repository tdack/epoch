import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { citations, repositories, sourceRepositories, sources } from '../db/schema';
import { ConcurrencyConflictError, SourceInUseError, UnauthorizedError } from '../domain/errors';
import {
	addTestMember,
	createTestDatabase,
	createTestTree,
	createTestUser,
	type TestDatabase
} from '../testing/d1';
import { ChangeLogService } from './change-log-service';
import { EvidenceService } from './evidence-service';
import { FactService } from './fact-service';
import { NameService } from './name-service';
import { PersonService } from './person-service';

let t: TestDatabase;
beforeAll(async () => {
	t = await createTestDatabase();
});
afterAll(async () => {
	await t.dispose();
});

const blank = { dateText: null, place: null, value: null, cause: null, age: null, notes: null };

async function setup() {
	const actor = await createTestUser(t.db);
	const treeId = await createTestTree(t.db, actor);
	const ctx = actor.context;
	const person = (
		await new PersonService(t.db).create(treeId, { givenName: 'Wren', surname: 'Ash' }, ctx)
	).individual;
	const facts = new FactService(t.db);
	const birth = await facts.create(
		treeId,
		person.id,
		{ ...blank, type: 'BIRT', dateText: '1900' },
		ctx
	);
	const evidence = new EvidenceService(t.db);
	const source = await evidence.createSource(treeId, { title: 'Parish register' }, ctx);
	const citationsOf = async (subjectId: string) =>
		(await t.db.select().from(citations).where(eq(citations.subjectId, subjectId)).all()).sort(
			(a, b) => a.sortOrder - b.sortOrder
		);
	return {
		actor,
		treeId,
		ctx,
		person,
		facts,
		evidence,
		birthId: birth.factId,
		sourceId: source.sourceId,
		citationsOf,
		log: new ChangeLogService(t.db)
	};
}

describe('citations through the mutation runner', () => {
	it('adds several in order, edits one, reorders, and undo restores each step', async () => {
		const { treeId, ctx, evidence, birthId, sourceId, citationsOf, log } = await setup();
		const subject = { kind: 'event' as const, id: birthId };
		const a = await evidence.addCitation(
			treeId,
			subject,
			{ sourceId, page: 'p 1', quality: 3 },
			ctx
		);
		const b = await evidence.addCitation(
			treeId,
			subject,
			{ sourceId, page: 'p 2', entryDate: 'ABT 1901' },
			ctx
		);
		expect((await citationsOf(birthId)).map((c) => c.page)).toEqual(['p 1', 'p 2']);
		expect((await citationsOf(birthId))[1]).toMatchObject({
			entryDateRaw: 'ABT 1901',
			entryDateQualifier: 'ABOUT'
		});
		expect(a.change?.summary).toBe('Cited “Parish register” for the birth of Wren Ash');

		await evidence.reorderCitations(treeId, subject, [b.citationId, a.citationId], ctx);
		expect((await citationsOf(birthId)).map((c) => c.page)).toEqual(['p 2', 'p 1']);
		await log.undoLast(treeId, ctx);
		expect((await citationsOf(birthId)).map((c) => c.page)).toEqual(['p 1', 'p 2']);

		const row = (await citationsOf(birthId))[0];
		await evidence.updateCitation(treeId, row.id, { page: 'p 9' }, row.version, ctx);
		expect((await citationsOf(birthId))[0].page).toBe('p 9');
		await log.undoLast(treeId, ctx);
		expect((await citationsOf(birthId))[0].page).toBe('p 1');
	});

	it('answers a stale edit with STALE_VERSION and the current values', async () => {
		const { treeId, ctx, evidence, birthId, sourceId, citationsOf } = await setup();
		await evidence.addCitation(
			treeId,
			{ kind: 'event', id: birthId },
			{ sourceId, page: 'p 1' },
			ctx
		);
		const row = (await citationsOf(birthId))[0];
		await evidence.updateCitation(treeId, row.id, { page: 'p 2' }, row.version, ctx);
		const error = await evidence
			.updateCitation(treeId, row.id, { page: 'p 3' }, row.version, ctx)
			.catch((e) => e);
		expect(error).toBeInstanceOf(ConcurrencyConflictError);
		expect(error.details).toMatchObject({
			reason: 'STALE_VERSION',
			entity: 'citation',
			current: { page: 'p 2' }
		});
	});

	it('takes a fact’s citations with it when the fact is deleted, and undo brings them back', async () => {
		const { treeId, ctx, evidence, facts, birthId, sourceId, citationsOf, log } = await setup();
		const subject = { kind: 'event' as const, id: birthId };
		await evidence.addCitation(treeId, subject, { sourceId, page: 'p 1' }, ctx);
		await evidence.addCitation(treeId, subject, { sourceId, page: 'p 2' }, ctx);
		const birth = (await t.db.query.events.findFirst({ where: (e, { eq }) => eq(e.id, birthId) }))!;
		await facts.remove(treeId, birthId, birth.version, ctx);
		expect(await citationsOf(birthId)).toEqual([]);
		await log.undoLast(treeId, ctx);
		expect((await citationsOf(birthId)).map((c) => c.page)).toEqual(['p 1', 'p 2']);
	});

	it('takes a name’s and a person’s citations when the person is deleted', async () => {
		const { treeId, ctx, evidence, person, sourceId, citationsOf, log } = await setup();
		await evidence.addCitation(
			treeId,
			{ kind: 'person', id: person.id },
			{ sourceId, page: 'mine' },
			ctx
		);
		const names = new NameService(t.db);
		const created = await names.create(
			treeId,
			person.id,
			{ type: 'aka', givenName: 'Wrennie', surname: null },
			false,
			ctx
		);
		await evidence.addCitation(
			treeId,
			{ kind: 'name', id: created.nameId },
			{ sourceId, page: 'nick' },
			ctx
		);
		await new PersonService(t.db).remove(treeId, person.id, ctx);
		expect(await citationsOf(person.id)).toEqual([]);
		expect(await citationsOf(created.nameId)).toEqual([]);
		await log.undoLast(treeId, ctx);
		expect((await citationsOf(person.id)).map((c) => c.page)).toEqual(['mine']);
		expect((await citationsOf(created.nameId)).map((c) => c.page)).toEqual(['nick']);
	});

	it('refuses to cite what is not there', async () => {
		const { treeId, ctx, evidence, sourceId } = await setup();
		await expect(
			evidence.addCitation(treeId, { kind: 'event', id: 'nope' }, { sourceId }, ctx)
		).rejects.toMatchObject({ code: 'NOT_FOUND' });
		await expect(
			evidence.addCitation(treeId, { kind: 'person', id: 'nope' }, { sourceId: 'nope' }, ctx)
		).rejects.toMatchObject({ code: 'NOT_FOUND' });
	});
});

describe('sources', () => {
	it('gives a new source a stable XREF and requires it to say something', async () => {
		const { treeId, ctx, evidence, sourceId } = await setup();
		const row = (await t.db.select().from(sources).where(eq(sources.id, sourceId)).get())!;
		expect(row.xref).toMatch(/^@S[0-9A-Z]{8,}@$/);
		await expect(evidence.createSource(treeId, { title: '  ' }, ctx)).rejects.toMatchObject({
			code: 'VALIDATION_ERROR'
		});
	});

	it('refuses to delete a cited source with the count, and removes the citations when told to', async () => {
		const { treeId, ctx, evidence, birthId, sourceId, citationsOf, log } = await setup();
		const subject = { kind: 'event' as const, id: birthId };
		await evidence.addCitation(treeId, subject, { sourceId, page: 'p 1' }, ctx);
		await evidence.addCitation(treeId, subject, { sourceId, page: 'p 2' }, ctx);

		const refused = await evidence.deleteSource(treeId, sourceId, {}, ctx).catch((e) => e);
		expect(refused).toBeInstanceOf(SourceInUseError);
		expect(refused.details).toMatchObject({ reason: 'SOURCE_IN_USE', citationCount: 2 });

		const preview = await evidence.preview(
			treeId,
			{ kind: 'delete_source', sourceId, shouldRemoveCitations: true },
			ctx
		);
		expect(preview.isDestructive).toBe(true);
		expect(preview.records.filter((r) => r.entityType === 'citation')).toHaveLength(2);

		await evidence.deleteSource(treeId, sourceId, { shouldRemoveCitations: true }, ctx);
		expect(await citationsOf(birthId)).toEqual([]);
		expect(await t.db.select().from(sources).where(eq(sources.id, sourceId)).all()).toEqual([]);
		await log.undoLast(treeId, ctx);
		expect((await citationsOf(birthId)).map((c) => c.page)).toEqual(['p 1', 'p 2']);
	});

	it('merges two sources, moving every citation in order, and undo moves them back', async () => {
		const { treeId, ctx, evidence, birthId, sourceId, citationsOf, log } = await setup();
		const other = await evidence.createSource(
			treeId,
			{ title: 'Parish register (copy)', author: 'Rev A' },
			ctx
		);
		const subject = { kind: 'event' as const, id: birthId };
		await evidence.addCitation(treeId, subject, { sourceId, page: 'p 1' }, ctx);
		await evidence.addCitation(treeId, subject, { sourceId: other.sourceId, page: 'p 2' }, ctx);

		const preview = await evidence.preview(
			treeId,
			{ kind: 'merge_sources', survivorId: sourceId, mergedIds: [other.sourceId] },
			ctx
		);
		expect(preview.records.filter((r) => r.entityType === 'citation')).toHaveLength(1);

		await evidence.mergeSources(treeId, sourceId, [other.sourceId], undefined, ctx);
		const after = await citationsOf(birthId);
		expect(after.map((c) => [c.page, c.sourceId])).toEqual([
			['p 1', sourceId],
			['p 2', sourceId]
		]);
		const survivor = (await t.db.select().from(sources).where(eq(sources.id, sourceId)).get())!;
		expect(survivor).toMatchObject({
			author: 'Rev A',
			xrefAliases: [expect.stringMatching(/^@S/)]
		});
		await log.undoLast(treeId, ctx);
		expect((await citationsOf(birthId)).map((c) => c.sourceId)).toEqual([sourceId, other.sourceId]);
	});
});

describe('repositories', () => {
	it('links a repository to a source with a call number, unlinks it, and deletes it with its links', async () => {
		const { treeId, ctx, evidence, sourceId, log } = await setup();
		const repo = await evidence.createRepository(treeId, { name: 'County Archive' }, ctx);
		const link = await evidence.linkRepository(treeId, sourceId, repo.repositoryId, 'A-1', ctx);
		await expect(
			evidence.linkRepository(treeId, sourceId, repo.repositoryId, null, ctx)
		).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
		const row = (await t.db
			.select()
			.from(sourceRepositories)
			.where(eq(sourceRepositories.id, link.linkId))
			.get())!;
		expect(row.callNumber).toBe('A-1');

		await evidence.updateSourceRepository(treeId, link.linkId, 'B-2', row.version, ctx);
		expect(
			(await t.db
				.select()
				.from(sourceRepositories)
				.where(eq(sourceRepositories.id, link.linkId))
				.get())!.callNumber
		).toBe('B-2');

		await evidence.deleteRepository(treeId, repo.repositoryId, undefined, ctx);
		expect(
			await t.db
				.select()
				.from(sourceRepositories)
				.where(eq(sourceRepositories.sourceId, sourceId))
				.all()
		).toEqual([]);
		await log.undoLast(treeId, ctx);
		expect(
			await t.db.select().from(repositories).where(eq(repositories.id, repo.repositoryId)).all()
		).toHaveLength(1);
		expect(
			await t.db
				.select()
				.from(sourceRepositories)
				.where(eq(sourceRepositories.sourceId, sourceId))
				.all()
		).toHaveLength(1);
	});
});

describe('who may write evidence', () => {
	it('lets a contributor cite and make a source, and keeps edits and removals for an editor', async () => {
		const { treeId, evidence, birthId, citationsOf } = await setup();
		const contributor = await createTestUser(t.db, 'contributor');
		await addTestMember(t.db, treeId, contributor, 'contributor');
		const editor = await createTestUser(t.db, 'editor');
		await addTestMember(t.db, treeId, editor, 'editor');
		const subject = { kind: 'event' as const, id: birthId };

		// A contributor may see the fact only when its person is theirs or visibly dead; make the person public.
		await t.db.run(sql`update individuals set privacy = 'public' where tree_id = ${treeId}`);

		const made = await evidence.createSource(treeId, { title: 'Mine' }, contributor.context);
		expect(made.sourceId).toBeTruthy();
		const added = await evidence.addCitation(
			treeId,
			subject,
			{ sourceId: made.sourceId, page: 'p 1' },
			contributor.context
		);
		const row = (await citationsOf(birthId)).find((c) => c.id === added.citationId)!;
		await expect(
			evidence.updateCitation(treeId, row.id, { page: 'x' }, row.version, contributor.context)
		).rejects.toBeInstanceOf(UnauthorizedError);
		await expect(
			evidence.removeCitation(treeId, row.id, row.version, contributor.context)
		).rejects.toBeInstanceOf(UnauthorizedError);
		await expect(
			evidence.deleteSource(treeId, made.sourceId, {}, contributor.context)
		).rejects.toBeInstanceOf(UnauthorizedError);

		await evidence.updateCitation(treeId, row.id, { page: 'x' }, row.version, editor.context);
		expect((await citationsOf(birthId))[0].page).toBe('x');
	});
});
