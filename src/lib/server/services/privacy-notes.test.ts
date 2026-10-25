/**
 * Notes follow the people they describe (ADR-015, ADR-029). A note can name a living person, so an
 * inline note is visible only if its subject is, and a shared note only if a visible record uses it
 * or the viewer made it. A hidden note answers as a missing one does, and the SQL that pages and
 * counts is held to the same answers as the row filter.
 */

import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { individuals, notes } from '../db/schema';
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
import { maskRows } from '../domain/privacy-mask';
import { ChangeStore } from '../repositories/change-store';
import { NoteRepository } from '../repositories/note-repository';
import { EVERYONE_SHOWN_CUTOFF, livingCutoff } from '../domain/living-state';
import { NoteReadService } from './note-read-service';
import { NoteService } from './note-service';
import { PersonPageService } from './person-page-service';
import { UnionPageService } from './union-page-service';
import { EvidenceReadService } from './evidence-read-service';

const FIXTURE = `0 HEAD
0 @N1@ NOTE Livia Aliveson's diary, used only by her
0 @N2@ NOTE A story about the Oldman and Aliveson families
0 @N3@ NOTE Grandar's own shared note
0 @S1@ SOUR
1 TITL Birth certificate of Livia Aliveson
1 NOTE a note on the Livia source
0 @S2@ SOUR
1 TITL Census 1851
1 NOTE Livia is not in the 1851 census
0 @R1@ REPO
1 NAME Aliveson family archive
1 NOTE Livia’s repository note
0 @I1@ INDI
1 NAME Grandar /Oldman/
2 NOTE name note of Grandar
1 NOTE @N2@
1 NOTE @N3@
1 BIRT
2 DATE 1850
2 NOTE Grandar birth note
2 SOUR @S2@
3 PAGE 4
3 NOTE note on the census citation
0 @I2@ INDI
1 NAME Livia /Aliveson/
2 NOTE Livia name note
1 NOTE Livia person note
1 NOTE @N1@
1 NOTE @N2@
1 BIRT
2 DATE 1985
2 NOTE Livia birth note
2 SOUR @S1@
3 PAGE 7
3 NOTE note on Livia's citation
1 FAMS @F1@
1 FAMC @F0@
2 NOTE Livia link note
0 @I3@ INDI
1 NAME Parent /Oldman/
1 FAMS @F0@
0 @F0@ FAM
1 HUSB @I3@
1 CHIL @I2@
0 @F1@ FAM
1 HUSB @I1@
1 WIFE @I2@
1 NOTE Livia and Grandar partnership note
1 MARR
2 DATE 1990
2 NOTE marriage note naming Livia
0 TRLR`;

const SECRETS = ['Livia', 'Aliveson'];
const leaks = (value: unknown) => SECRETS.filter((s) => JSON.stringify(value).includes(s));

let t: TestDatabase;
let treeId: string;
const actors = {} as Record<TreeRole, TestActor>;
const ids = {} as Record<string, string>;

beforeAll(async () => {
	t = await createTestDatabase();
	actors.owner = await createTestUser(t.db, 'owner');
	treeId = await createTestTree(t.db, actors.owner);
	for (const role of ['editor', 'contributor', 'viewer'] as const) {
		actors[role] = await createTestUser(t.db, role);
		await addTestMember(t.db, treeId, actors[role], role);
	}
	await importGedcomToDb(t.d1, treeId, FIXTURE, 'Notes privacy');
	for (const row of await t.db.select().from(individuals).where(eq(individuals.treeId, treeId)))
		ids[row.xrefId!] = row.id;
	for (const row of await t.db.select().from(notes).where(eq(notes.treeId, treeId)))
		ids[row.xref!] = row.id;
}, 60_000);
afterAll(async () => {
	await t.dispose();
});

const NOW = new Date('2026-10-01T12:00:00Z');
const reads = () => new NoteReadService(t.db, () => NOW);
const service = () => new NoteService(t.db);

describe('reading notes as a contributor', () => {
	const ctx = () => actors.contributor.context;

	it('lists only the shared notes a visible record uses', async () => {
		const page = await reads().listNotes(treeId, {}, ctx());
		expect(page.items.map((n) => n.xref).sort()).toEqual(['@N2@', '@N3@']);
		expect(leaks(page.items.filter((n) => n.xref !== '@N2@'))).toEqual([]);
		// A search never finds a note it may not see.
		expect((await reads().listNotes(treeId, { q: 'diary' }, ctx())).items).toEqual([]);
	});

	it('counts only the uses of a shared note the viewer can see', async () => {
		const page = await reads().listNotes(treeId, {}, ctx());
		// N2 is on Grandar and on private Livia: the contributor sees one use.
		expect(page.items.find((n) => n.xref === '@N2@')!.useCount).toBe(1);
		const note = await reads().getNote(treeId, ids['@N2@'], {}, ctx());
		expect(note.useCount).toBe(1);
		expect(note.uses.map((u) => u.label)).toEqual(['Grandar Oldman']);
	});

	it('answers a shared note used only by private people as a note that is not there', async () => {
		const hidden = await reads()
			.getNote(treeId, ids['@N1@'], {}, ctx())
			.catch((e) => e);
		const missing = await reads()
			.getNote(treeId, 'no-such-note', {}, ctx())
			.catch((e) => e);
		expect(hidden).toBeInstanceOf(NotFoundError);
		expect(hidden.constructor).toBe(missing.constructor);
		expect(hidden.message.replace(ids['@N1@'], 'ID')).toBe(
			missing.message.replace('no-such-note', 'ID')
		);
	});

	it('shows a visible person’s notes, their shared notes with the visible use count, and nothing private', async () => {
		const people = new PersonPageService(t.db, () => NOW);
		const grandar = await people.getPerson(treeId, ids['@I1@'], ctx());
		expect(grandar.notes.map((n) => [n.text, n.isShared, n.usedBy])).toEqual([
			['A story about the Oldman and Aliveson families', true, 1],
			["Grandar's own shared note", true, 1]
		]);
		expect(grandar.names[0].notes.map((n) => n.text)).toEqual(['name note of Grandar']);
		expect(grandar.facts.find((f) => f.type === 'BIRT')!.noteItems.map((n) => n.text)).toEqual([
			'Grandar birth note'
		]);
		expect(grandar.evidence.citations[0].notes.map((n) => n.text)).toEqual([
			'note on the census citation'
		]);
		// The shared note names the Aliveson family in its words, which a visible person may carry:
		// it is on a visible record. What stays out is everything attached only to Livia.
		const asText = JSON.stringify(grandar);
		expect(asText).not.toContain('diary');
		expect(asText).not.toContain('Livia name note');
		expect(asText).not.toContain('Livia person note');
	});

	it('is told nothing of a private person’s notes by their page', async () => {
		const hidden = await new PersonPageService(t.db, () => NOW)
			.getPerson(treeId, ids['@I2@'], ctx())
			.catch((e) => e);
		expect(hidden).toBeInstanceOf(NotFoundError);
	});

	it('is told nothing of the notes of a partnership with a private partner', async () => {
		const page = await new UnionPageService(t.db, () => NOW)
			.getUnion(treeId, `${treeId}:@F1@`, ctx())
			.catch((e) => e);
		expect(leaks(page instanceof Error ? page.message : page)).toEqual([]);
	});

	it('sees the notes of a source it can see, and not those of a source it cannot', async () => {
		const evidence = new EvidenceReadService(t.db, () => NOW);
		const sources = await evidence.listSources(treeId, {}, ctx());
		expect(sources.items.map((s) => s.title)).toEqual(['Census 1851']);
		const census = await evidence.getSource(treeId, sources.items[0].id, {}, ctx());
		expect(census.notes.map((n) => n.text)).toEqual(['Livia is not in the 1851 census']);
	});
});

describe('a contributor writing notes', () => {
	const ctx = () => actors.contributor.context;

	it('cannot annotate a private person’s fact, and is answered as for one that does not exist', async () => {
		const [fact] = await t.d1
			.prepare("select id from events where entity_id = ?1 and type = 'BIRT'")
			.bind(ids['@I2@'])
			.all<{ id: string }>()
			.then((r) => r.results);
		const hidden = await service()
			.addNote(treeId, { kind: 'event', id: fact.id }, 'x', ctx())
			.catch((e) => e);
		const missing = await service()
			.addNote(treeId, { kind: 'event', id: 'no-such-fact' }, 'x', ctx())
			.catch((e) => e);
		expect(hidden.constructor).toBe(missing.constructor);
		expect(hidden.message.replace(fact.id, 'ID')).toBe(
			missing.message.replace('no-such-fact', 'ID')
		);
		expect(leaks(hidden.message)).toEqual([]);
	});

	it('cannot attach a shared note used only by private people, as for one that does not exist', async () => {
		const hidden = await service()
			.attachNote(treeId, { kind: 'person', id: ids['@I1@'] }, ids['@N1@'], ctx())
			.catch((e) => e);
		const missing = await service()
			.attachNote(treeId, { kind: 'person', id: ids['@I1@'] }, 'no-such-note', ctx())
			.catch((e) => e);
		expect(hidden.constructor).toBe(missing.constructor);
		expect(hidden.message.replace(ids['@N1@'], 'ID')).toBe(
			missing.message.replace('no-such-note', 'ID')
		);
	});

	it('cannot preview or merge notes it cannot see', async () => {
		for (const attempt of [
			service().preview(
				treeId,
				{ kind: 'delete_shared_note', noteId: ids['@N1@'], shouldDetach: true },
				ctx()
			),
			service().mergeNotes(treeId, ids['@N2@'], [ids['@N1@']], undefined, ctx())
		]) {
			const error = await attempt.catch((e) => e);
			expect(error).toBeInstanceOf(Error);
			expect(leaks(error.message)).toEqual([]);
			expect(['UNAUTHORIZED', 'NOT_FOUND']).toContain(error.code);
		}
	});

	it('sees the shared note it made itself, before anything uses it', async () => {
		const made = await service().createNote(treeId, { text: 'my own draft' }, ctx());
		const page = await reads().listNotes(treeId, {}, ctx());
		expect(page.items.map((n) => n.id)).toContain(made.noteId);
		expect((await reads().getNote(treeId, made.noteId, {}, ctx())).text).toBe('my own draft');
		// Another contributor does not.
		const other = await createTestUser(t.db, 'contributor');
		await addTestMember(t.db, treeId, other, 'contributor');
		expect(
			(await reads().listNotes(treeId, {}, other.context)).items.map((n) => n.id)
		).not.toContain(made.noteId);
	});
});

describe('reading notes as an editor', () => {
	it('sees every shared note and every use', async () => {
		const ctx = actors.editor.context;
		const page = await reads().listNotes(treeId, {}, ctx);
		expect(page.items.map((n) => n.xref).sort()).toEqual(
			expect.arrayContaining(['@N1@', '@N2@', '@N3@'])
		);
		const note = await reads().getNote(treeId, ids['@N2@'], {}, ctx);
		expect(note.useCount).toBe(2);
		expect(note.uses.map((u) => u.label).sort()).toEqual(['Grandar Oldman', 'Livia Aliveson']);
	});
});

describe('the SQL and the row filters agree on what notes a viewer sees', () => {
	it.each(['contributor', 'viewer', 'public'] as const)('for a %s', async (role) => {
		const rows = await new ChangeStore(t.db).loadRows(treeId);
		const scope = {
			isRestricted: true,
			cutoff: role === 'public' ? EVERYONE_SHOWN_CUTOFF : livingCutoff(NOW, 110),
			creatorId: role === 'contributor' ? actors.contributor.userId : null
		};
		const masked = maskRows(rows, scope.cutoff, false, scope.creatorId).rows;
		const repo = new NoteRepository(t.db);

		const attachmentIds = (await repo.visibleAttachmentIds(treeId, scope)).sort();
		expect(attachmentIds).toEqual(masked.noteAttachments.map((a) => a.id).sort());
		// Every kind of subject is in play: person, name, fact, partnership, link, source, repository, citation.
		expect(new Set(rows.noteAttachments.map((a) => a.subjectKind))).toEqual(
			new Set([
				'person',
				'name',
				'event',
				'union',
				'parent_child',
				'source',
				'repository',
				'citation'
			])
		);

		const noteIds = (await repo.noteIds(treeId, '', { offset: 0, limit: 100 }, scope)).ids.sort();
		expect(noteIds).toEqual(masked.notes.map((n) => n.id).sort());

		// Looked up singly, a note is narrowed to its own attachments and answers as the list does.
		const noteIdsMasked = new Set(masked.notes.map((n) => n.id));
		for (const note of rows.notes) {
			const one = await repo.visibleNote(treeId, note.id, scope);
			expect(one !== undefined, note.xref ?? '').toBe(noteIdsMasked.has(note.id));
		}
		if (role !== 'public')
			expect(
				rows.notes.some((n) => n.xref === '@N1@' && !noteIdsMasked.has(n.id)),
				'N1 is used only by a private person'
			).toBe(true);

		const counts = await repo.visibleUseCounts(
			treeId,
			rows.notes.map((n) => n.id),
			scope
		);
		for (const note of rows.notes) {
			expect(counts.get(note.id) ?? 0, note.xref ?? '').toBe(
				masked.noteAttachments.filter((a) => a.noteId === note.id).length
			);
		}
	});
});
