/**
 * Evidence follows the people it supports (ADR-015, ADR-028). A source title can name a living
 * person, so a citation is visible only if its subject is, and a source or repository only if it
 * supports something the viewer may see. A hidden record answers as a missing one does.
 */

import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { events, individuals, sources } from '../db/schema';
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
