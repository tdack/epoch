/**
 * Evidence follows the people it supports (ADR-015, ADR-028). A source title can name a living
 * person, so a citation is visible only if its subject is, and a source or repository only if it
 * supports something the viewer may see. A hidden record answers as a missing one does.
 */

import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { events, individuals, sources } from '../db/schema';
import { NotFoundError } from '../domain/errors';
import { CITATION_SUBJECT_KINDS } from '../../shared/evidence';
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
import { maskRows } from '../domain/privacy-mask';
import { ChangeStore } from '../repositories/change-store';
import { EvidenceReadService } from './evidence-read-service';
import { EvidenceRepository } from '../repositories/evidence-repository';
import { PersonPageService } from './person-page-service';
import { UnionPageService } from './union-page-service';
import { livingCutoff } from '../domain/living-state';
import { EvidenceService } from './evidence-service';

const FIXTURE = `0 HEAD
0 @S1@ SOUR
1 TITL Birth certificate of Livia Aliveson
1 REPO @R1@
2 CALN LIVIA-1
0 @S2@ SOUR
1 TITL Census 1851
0 @R1@ REPO
1 NAME Aliveson family archive
0 @I1@ INDI
1 NAME Grandar /Oldman/
1 BIRT
2 DATE 1850
2 SOUR @S2@
3 PAGE 4
0 @I2@ INDI
1 NAME Livia /Aliveson/
1 SOUR @S1@
2 PAGE person
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
2 SOUR @S1@
3 PAGE marriage
0 TRLR`;

const SECRETS = ['Livia', 'Aliveson'];
const leaks = (value: unknown) => SECRETS.filter((s) => JSON.stringify(value).includes(s));

let t: TestDatabase;
let treeId: string;
const actors = {} as Record<TreeRole, TestActor>;
const ids = {} as Record<string, string>;
const evidence = () => new EvidenceService(t.db);

beforeAll(async () => {
	t = await createTestDatabase();
	actors.owner = await createTestUser(t.db, 'owner');
	treeId = await createTestTree(t.db, actors.owner);
	for (const role of ['editor', 'contributor', 'viewer'] as const) {
		actors[role] = await createTestUser(t.db, role);
		await addTestMember(t.db, treeId, actors[role], role);
	}
	await importGedcomToDb(t.d1, treeId, FIXTURE, 'Evidence privacy');
	for (const row of await t.db.select().from(individuals).where(eq(individuals.treeId, treeId)))
		ids[row.xrefId!] = row.id;
	for (const row of await t.db.select().from(sources).where(eq(sources.treeId, treeId)))
		ids[row.xref!] = row.id;
	for (const row of await t.db.select().from(events).where(eq(events.treeId, treeId)))
		ids[`${row.entityId.split(':')[1]}:${row.type}`] = row.id;
}, 60_000);
afterAll(async () => {
	await t.dispose();
});

describe('a contributor writing evidence', () => {
	const ctx = () => actors.contributor.context;

	it('cannot cite a private person’s fact, and is answered as for one that does not exist', async () => {
		const hidden = await evidence()
			.addCitation(
				treeId,
				{ kind: 'event', id: ids['@I2@:BIRT'] },
				{ sourceId: ids['@S2@'] },
				ctx()
			)
			.catch((e) => e);
		const missing = await evidence()
			.addCitation(treeId, { kind: 'event', id: 'no-such-fact' }, { sourceId: ids['@S2@'] }, ctx())
			.catch((e) => e);
		expect(hidden.constructor).toBe(missing.constructor);
		expect(hidden.message.replace(ids['@I2@:BIRT'], 'ID')).toBe(
			missing.message.replace('no-such-fact', 'ID')
		);
		expect(leaks(hidden.message)).toEqual([]);
	});

	it('cannot cite with a source that supports only private people, as for one that does not exist', async () => {
		const hidden = await evidence()
			.addCitation(
				treeId,
				{ kind: 'event', id: ids['@I1@:BIRT'] },
				{ sourceId: ids['@S1@'] },
				ctx()
			)
			.catch((e) => e);
		const missing = await evidence()
			.addCitation(
				treeId,
				{ kind: 'event', id: ids['@I1@:BIRT'] },
				{ sourceId: 'no-such-source' },
				ctx()
			)
			.catch((e) => e);
		expect(hidden.constructor).toBe(missing.constructor);
		expect(hidden.message.replace(ids['@S1@'], 'ID')).toBe(
			missing.message.replace('no-such-source', 'ID')
		);
		expect(leaks(hidden.message)).toEqual([]);
	});

	it('can cite a public person’s fact with a source that supports one', async () => {
		const added = await evidence().addCitation(
			treeId,
			{ kind: 'event', id: ids['@I1@:BIRT'] },
			{ sourceId: ids['@S2@'], page: 'mine' },
			ctx()
		);
		expect(added.change?.summary).toContain('Census 1851');
	});

	it('cannot preview or make a change to evidence it cannot see', async () => {
		for (const attempt of [
			evidence().preview(
				treeId,
				{ kind: 'delete_source', sourceId: ids['@S1@'], shouldRemoveCitations: true },
				ctx()
			),
			evidence().deleteSource(treeId, ids['@S1@'], { shouldRemoveCitations: true }, ctx()),
			evidence().mergeSources(treeId, ids['@S2@'], [ids['@S1@']], undefined, ctx()),
			evidence().linkRepository(treeId, ids['@S1@'], 'any', null, ctx())
		]) {
			const error = await attempt.catch((e) => e);
			expect(error).toBeInstanceOf(Error);
			expect(leaks(error.message)).toEqual([]);
			expect(['UNAUTHORIZED', 'NOT_FOUND']).toContain(error.code);
		}
	});

	it('is told nothing of a hidden citation when it tries to edit or remove one', async () => {
		const citationId = (await t.d1
			.prepare('select id from citations where subject_id = ?1')
			.bind(ids['@I2@:BIRT'])
			.first<{ id: string }>())!.id;
		for (const attempt of [
			evidence().updateCitation(treeId, citationId, { page: 'x' }, 1, ctx()),
			evidence().removeCitation(treeId, citationId, 1, ctx())
		]) {
			const error = await attempt.catch((e) => e);
			expect(['UNAUTHORIZED', 'NOT_FOUND']).toContain(error.code);
			expect(leaks(error.message)).toEqual([]);
		}
	});
});

describe('an editor writing evidence', () => {
	it('sees everyone, so can cite a private person’s fact with a source that supports only them', async () => {
		const added = await evidence().addCitation(
			treeId,
			{ kind: CITATION_SUBJECT_KINDS.EVENT, id: ids['@I2@:BIRT'] },
			{ sourceId: ids['@S1@'], page: 'editor' },
			actors.editor.context
		);
		expect(added.citationId).toBeTruthy();
	});
});

const NOW = new Date('2026-10-01T12:00:00Z');
const reads = () => new EvidenceReadService(t.db, () => NOW);

describe('reading evidence as a contributor', () => {
	const ctx = () => actors.contributor.context;

	it('lists only the sources that support someone they can see', async () => {
		const page = await reads().listSources(treeId, {}, ctx());
		expect(page.items.map((s) => s.title)).toEqual(['Census 1851']);
		expect(leaks(page)).toEqual([]);
		const found = await reads().listSources(treeId, { q: 'Livia' }, ctx());
		expect(found.items).toEqual([]);
	});

	it('answers a source that supports only private people as one that is not there', async () => {
		const hidden = await reads()
			.getSource(treeId, ids['@S1@'], {}, ctx())
			.catch((e) => e);
		const missing = await reads()
			.getSource(treeId, 'no-such-source', {}, ctx())
			.catch((e) => e);
		expect(hidden).toBeInstanceOf(NotFoundError);
		expect(hidden.constructor).toBe(missing.constructor);
		expect(hidden.message.replace(ids['@S1@'], 'ID')).toBe(
			missing.message.replace('no-such-source', 'ID')
		);
	});

	it('shows a visible source with only the citations they may see', async () => {
		const source = await reads().getSource(treeId, ids['@S2@'], {}, ctx());
		expect(source.title).toBe('Census 1851');
		expect(source.groups.flatMap((g) => g.citations.map((c) => c.page)).sort()).toEqual([
			'4',
			'mine'
		]);
		expect(leaks(source)).toEqual([]);
	});

	it('does not list a repository kept only for a source they cannot see', async () => {
		const page = await reads().listRepositories(treeId, {}, ctx());
		expect(page.items).toEqual([]);
		expect(leaks(page)).toEqual([]);
	});

	it('is told nothing of a private person’s evidence by their page', async () => {
		const people = new PersonPageService(t.db, () => NOW);
		const hidden = await people.getPerson(treeId, ids['@I2@'], ctx()).catch((e) => e);
		expect(hidden).toBeInstanceOf(NotFoundError);
		const grandar = await people.getPerson(treeId, ids['@I1@'], ctx());
		expect(grandar.evidence.citations.map((c) => c.page).sort()).toEqual(['4', 'mine']);
		expect(grandar.facts.find((f) => f.type === 'BIRT')?.citationCount).toBe(2);
		expect(leaks(grandar)).toEqual([]);
	});

	it('is told nothing of the evidence of a partnership with a private partner', async () => {
		const unions = new UnionPageService(t.db, () => NOW);
		const unionId = `${treeId}:@F1@`;
		const page = await unions.getUnion(treeId, unionId, ctx()).catch((e) => e);
		expect(leaks(page instanceof Error ? page.message : page)).toEqual([]);
		if (!(page instanceof Error)) expect(page.evidence.citations).toEqual([]);
	});
});

describe('reading evidence as an editor', () => {
	it('sees every source, repository and citation', async () => {
		const ctx = actors.editor.context;
		const page = await reads().listSources(treeId, {}, ctx);
		expect(page.items.map((s) => s.title).sort()).toEqual([
			'Birth certificate of Livia Aliveson',
			'Census 1851'
		]);
		const livia = await reads().getSource(treeId, ids['@S1@'], {}, ctx);
		expect(livia.repositories).toMatchObject([
			{ name: 'Aliveson family archive', callNumber: 'LIVIA-1' }
		]);
		expect(livia.citationCount).toBeGreaterThanOrEqual(4);
		expect((await reads().listRepositories(treeId, {}, ctx)).items).toHaveLength(1);
		const person = await new PersonPageService(t.db, () => NOW).getPerson(treeId, ids['@I2@'], ctx);
		expect(person.facts.find((f) => f.type === 'BIRT')?.citationCount).toBeGreaterThanOrEqual(1);
	});
});

describe('the SQL and the row filters agree on what evidence a viewer sees', () => {
	it.each(['contributor', 'viewer'] as const)('for a %s', async (role) => {
		const rows = await new ChangeStore(t.db).loadRows(treeId);
		const scope = {
			isRestricted: true,
			cutoff: livingCutoff(NOW, 110),
			creatorId: role === 'contributor' ? actors.contributor.userId : null
		};
		const masked = maskRows(rows, scope.cutoff, false, scope.creatorId).rows;
		const repo = new EvidenceRepository(t.db);
		const sourceIdsSql = (await repo.sourceIds(treeId, '', { offset: 0, limit: 100 }, scope)).ids;
		expect(sourceIdsSql.sort()).toEqual(masked.sources.map((s) => s.id).sort());
		const repositoryIdsSql = (
			await repo.repositoryIds(treeId, '', { offset: 0, limit: 100 }, scope)
		).ids;
		expect(repositoryIdsSql.sort()).toEqual(masked.repositories.map((r) => r.id).sort());
		const counts = await repo.visibleCitationCounts(
			treeId,
			rows.sources.map((s) => s.id),
			scope
		);
		for (const source of rows.sources) {
			expect(counts.get(source.id) ?? 0, source.title ?? '').toBe(
				masked.citations.filter((c) => c.sourceId === source.id).length
			);
		}
	});
});
