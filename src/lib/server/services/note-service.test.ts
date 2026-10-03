import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { events, noteAttachments, notes, personNames } from '../db/schema';
import {
	ConcurrencyConflictError,
	NoteInUseError,
	UnauthorizedError,
	ValidationError
} from '../domain/errors';
import { buildGedcom551String, buildGedcom7String } from '../gedcom/serializer';
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
import { EvidenceService } from './evidence-service';
import { FactService } from './fact-service';
import { NameService } from './name-service';
import { NoteService } from './note-service';
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
	const people = new PersonService(t.db);
	const person = (await people.create(treeId, { givenName: 'Wren', surname: 'Ash' }, ctx))
		.individual;
	const other = (await people.create(treeId, { givenName: 'Bram', surname: 'Ash' }, ctx))
		.individual;
	const facts = new FactService(t.db);
	const birth = await facts.create(
		treeId,
		person.id,
		{ ...blank, type: 'BIRT', dateText: '1900' },
		ctx
	);
	const noteOf = async (subjectId: string) =>
		(
			await t.db
				.select()
				.from(noteAttachments)
				.where(eq(noteAttachments.subjectId, subjectId))
				.all()
		).sort((a, b) => a.sortOrder - b.sortOrder);
	return {
		actor,
		treeId,
		ctx,
		person,
		other,
		facts,
		service: new NoteService(t.db),
		birthId: birth.factId,
		noteOf,
		log: new ChangeLogService(t.db)
	};
}

describe('a subject’s notes through the mutation runner', () => {
	it('adds several in order, edits one, reorders, removes one, and undo restores each step', async () => {
		const { treeId, ctx, service, person, noteOf, log } = await setup();
		const subject = { kind: 'person' as const, id: person.id };
		const a = await service.addNote(treeId, subject, 'first', ctx);
		const b = await service.addNote(treeId, subject, 'second\nline', ctx);
		expect((await noteOf(person.id)).map((n) => n.text)).toEqual(['first', 'second\nline']);
		expect(a.change?.summary).toBe('Added a note to Wren Ash');

		await service.reorderNotes(treeId, subject, [b.attachmentId, a.attachmentId], ctx);
		expect((await noteOf(person.id)).map((n) => n.text)).toEqual(['second\nline', 'first']);
		await log.undoLast(treeId, ctx);
		expect((await noteOf(person.id)).map((n) => n.text)).toEqual(['first', 'second\nline']);

		const row = (await noteOf(person.id))[0];
		await service.updateNote(treeId, row.id, 'first, edited', row.version, ctx);
		expect((await noteOf(person.id))[0].text).toBe('first, edited');
		await log.undoLast(treeId, ctx);
		expect((await noteOf(person.id))[0].text).toBe('first');

		const current = (await noteOf(person.id))[0];
		await service.removeNote(treeId, current.id, current.version, ctx);
		expect((await noteOf(person.id)).map((n) => n.text)).toEqual(['second\nline']);
		await log.undoLast(treeId, ctx);
		expect((await noteOf(person.id)).map((n) => n.text)).toEqual(['first', 'second\nline']);
	});

	it('answers a stale edit with STALE_VERSION and the current words', async () => {
		const { treeId, ctx, service, person, noteOf } = await setup();
		await service.addNote(treeId, { kind: 'person', id: person.id }, 'one', ctx);
		const row = (await noteOf(person.id))[0];
		await service.updateNote(treeId, row.id, 'two', row.version, ctx);
		const error = await service
			.updateNote(treeId, row.id, 'three', row.version, ctx)
			.catch((e) => e);
		expect(error).toBeInstanceOf(ConcurrencyConflictError);
		expect(error.details).toMatchObject({
			reason: 'STALE_VERSION',
			entity: 'note_link',
			current: { text: 'two' }
		});
	});

	it('refuses an empty note and a note on what is not there', async () => {
		const { treeId, ctx, service, person } = await setup();
		await expect(
			service.addNote(treeId, { kind: 'person', id: person.id }, '  ', ctx)
		).rejects.toBeInstanceOf(ValidationError);
		await expect(
			service.addNote(treeId, { kind: 'event', id: 'nope' }, 'x', ctx)
		).rejects.toMatchObject({ code: 'NOT_FOUND' });
	});

	it('refuses a change that would write more than 300 records', async () => {
		const { treeId, ctx, service, person, noteOf } = await setup();
		const made = await service.createNote(treeId, { text: 'shared widely' }, ctx);
		const now = Date.now();
		// 301 attachments, written straight to the table: no command makes this many one at a time.
		const rows = Array.from({ length: 301 }, (_, i) => ({
			id: crypto.randomUUID(),
			treeId,
			subjectKind: 'person' as const,
			subjectId: person.id,
			sortOrder: i,
			noteId: made.noteId,
			noteRef: null,
			gedcomTag: null,
			text: null,
			gedcomExtra: null,
			gedcomLayout: null,
			version: 1,
			createdAt: new Date(now),
			updatedAt: new Date(now)
		}));
		for (let i = 0; i < rows.length; i += 5)
			await t.db.insert(noteAttachments).values(rows.slice(i, i + 5));
		const error = await service
			.deleteSharedNote(treeId, made.noteId, { shouldDetach: true }, ctx)
			.catch((e) => e);
		expect(error).toBeInstanceOf(ValidationError);
		expect(error.message).toContain('at most 300');
		expect(await noteOf(person.id)).toHaveLength(301);
	});
});

describe('shared notes', () => {
	it('turns an inline note into a shared one, attaches it elsewhere, and edits it for both', async () => {
		const { treeId, ctx, service, person, other, noteOf, log } = await setup();
		await service.addNote(treeId, { kind: 'person', id: person.id }, 'a family story', ctx);
		const row = (await noteOf(person.id))[0];
		const shared = await service.shareNote(treeId, row.id, row.version, ctx);
		const record = (await t.db.select().from(notes).where(eq(notes.id, shared.noteId)).get())!;
		expect(record).toMatchObject({ text: 'a family story', gedcomTag: null });
		expect(record.xref).toMatch(/^@N[0-9A-Z]{8,}@$/);
		expect((await noteOf(person.id))[0]).toMatchObject({ noteId: shared.noteId, text: null });

		await service.attachNote(treeId, { kind: 'person', id: other.id }, shared.noteId, ctx);
		await expect(
			service.attachNote(treeId, { kind: 'person', id: other.id }, shared.noteId, ctx)
		).rejects.toBeInstanceOf(ValidationError);
		await service.updateSharedNote(
			treeId,
			shared.noteId,
			{ text: 'a better story' },
			record.version,
			ctx
		);
		expect((await t.db.select().from(notes).where(eq(notes.id, shared.noteId)).get())!.text).toBe(
			'a better story'
		);
		await log.undoLast(treeId, ctx);
		expect((await t.db.select().from(notes).where(eq(notes.id, shared.noteId)).get())!.text).toBe(
			'a family story'
		);
	});

	it('refuses to delete a used note with the count, detaches it when told to, and undo restores it', async () => {
		const { treeId, ctx, service, person, other, noteOf, log } = await setup();
		const made = await service.createNote(treeId, { text: 'used twice' }, ctx);
		await service.attachNote(treeId, { kind: 'person', id: person.id }, made.noteId, ctx);
		await service.attachNote(treeId, { kind: 'person', id: other.id }, made.noteId, ctx);

		const refused = await service.deleteSharedNote(treeId, made.noteId, {}, ctx).catch((e) => e);
		expect(refused).toBeInstanceOf(NoteInUseError);
		expect(refused.details).toMatchObject({ reason: 'NOTE_IN_USE', useCount: 2 });

		const preview = await service.preview(
			treeId,
			{ kind: 'delete_shared_note', noteId: made.noteId, shouldDetach: true },
			ctx
		);
		expect(preview.isDestructive).toBe(true);
		expect(preview.records.filter((r) => r.entityType === 'note_link')).toHaveLength(2);

		await service.deleteSharedNote(treeId, made.noteId, { shouldDetach: true }, ctx);
		expect(await noteOf(person.id)).toEqual([]);
		expect(await t.db.select().from(notes).where(eq(notes.id, made.noteId)).all()).toEqual([]);
		await log.undoLast(treeId, ctx);
		expect(await noteOf(person.id)).toHaveLength(1);
		expect(await noteOf(other.id)).toHaveLength(1);
	});

	it('merges notes: every use moves to the survivor and the merged XREF becomes an alias', async () => {
		const { treeId, ctx, service, person, other, noteOf, log } = await setup();
		const keep = await service.createNote(treeId, { text: 'keep', language: 'en' }, ctx);
		const fold = await service.createNote(treeId, { text: 'fold', mime: 'text/html' }, ctx);
		await service.attachNote(treeId, { kind: 'person', id: person.id }, keep.noteId, ctx);
		await service.attachNote(treeId, { kind: 'person', id: person.id }, fold.noteId, ctx);
		await service.attachNote(treeId, { kind: 'person', id: other.id }, fold.noteId, ctx);
		const folded = (await t.db.select().from(notes).where(eq(notes.id, fold.noteId)).get())!;

		const preview = await service.preview(
			treeId,
			{ kind: 'merge_notes', survivorId: keep.noteId, mergedIds: [fold.noteId] },
			ctx
		);
		expect(preview.carriedNotes).toBe(2);

		await service.mergeNotes(treeId, keep.noteId, [fold.noteId], undefined, ctx);
		const survivor = (await t.db.select().from(notes).where(eq(notes.id, keep.noteId)).get())!;
		expect(survivor).toMatchObject({ text: 'keep', language: 'en', mime: 'text/html' });
		expect(survivor.xrefAliases).toEqual([folded.xref]);
		// The person that pointed at both now points at the survivor once.
		expect((await noteOf(person.id)).map((n) => n.noteId)).toEqual([keep.noteId]);
		expect((await noteOf(other.id)).map((n) => n.noteId)).toEqual([keep.noteId]);
		await log.undoLast(treeId, ctx);
		expect((await noteOf(person.id)).map((n) => n.noteId)).toEqual([keep.noteId, fold.noteId]);
	});
});

describe('who may write notes', () => {
	it('lets a contributor add, and keeps editing, sharing and removing for an editor', async () => {
		const { treeId, service, person, noteOf } = await setup();
		const contributor = await createTestUser(t.db, 'contributor');
		await addTestMember(t.db, treeId, contributor, 'contributor');
		const editor = await createTestUser(t.db, 'editor');
		await addTestMember(t.db, treeId, editor, 'editor');
		await t.db.run(sql`update individuals set privacy = 'public' where tree_id = ${treeId}`);
		const subject = { kind: 'person' as const, id: person.id };

		const added = await service.addNote(treeId, subject, 'mine', contributor.context);
		const row = (await noteOf(person.id)).find((n) => n.id === added.attachmentId)!;
		await expect(
			service.updateNote(treeId, row.id, 'x', row.version, contributor.context)
		).rejects.toBeInstanceOf(UnauthorizedError);
		await expect(
			service.removeNote(treeId, row.id, row.version, contributor.context)
		).rejects.toBeInstanceOf(UnauthorizedError);
		await expect(
			service.deleteSharedNote(treeId, 'whatever', {}, contributor.context)
		).rejects.toBeInstanceOf(UnauthorizedError);
		await expect(
			service.shareNote(treeId, row.id, row.version, contributor.context)
		).rejects.toBeInstanceOf(UnauthorizedError);
		const shared = await service.shareNote(treeId, row.id, row.version, editor.context);
		expect(shared.noteId).toBeTruthy();

		const fresh = (await noteOf(person.id)).find((n) => n.id === added.attachmentId)!;
		await service.removeNote(treeId, fresh.id, fresh.version, editor.context);
		expect(await noteOf(person.id)).toEqual([]);
	});
});

describe('a fact’s notes', () => {
	it('are written and read as note records by the fact editor, and the column is not written', async () => {
		const { treeId, ctx, person, facts, noteOf } = await setup();
		const made = await facts.create(
			treeId,
			person.id,
			{ ...blank, type: 'OCCU', value: 'Weaver', notes: 'at the mill' },
			ctx
		);
		const row = (await t.db.select().from(events).where(eq(events.id, made.factId)).get())!;
		expect(row.notes).toBeNull();
		expect((await noteOf(made.factId)).map((n) => n.text)).toEqual(['at the mill']);

		await facts.update(treeId, made.factId, { notes: 'at the other mill' }, row.version, ctx);
		expect((await noteOf(made.factId)).map((n) => n.text)).toEqual(['at the other mill']);
		const again = (await t.db.select().from(events).where(eq(events.id, made.factId)).get())!;
		await facts.update(treeId, made.factId, { notes: null }, again.version, ctx);
		expect(await noteOf(made.factId)).toEqual([]);
	});

	it('keep a legacy description visible and exported: it becomes the first note when a note is added', async () => {
		const { treeId, ctx, service, noteOf } = await setup();
		const file = `0 HEAD
1 GEDC
2 VERS 5.5.1
0 @I1@ INDI
1 NAME Old /Fact/
1 RESI
2 PLAC Leeds
0 TRLR`;
		await importGedcomToDb(t.d1, treeId, file, 'Legacy', 'merge');
		const fact = (await t.db.select().from(events).where(eq(events.type, 'RESI')).all()).find(
			(e) => e.treeId === treeId
		)!;
		await t.db.update(events).set({ description: 'imported words' }).where(eq(events.id, fact.id));

		await service.addNote(treeId, { kind: 'event', id: fact.id }, 'a new note', ctx);
		expect((await noteOf(fact.id)).map((n) => n.text)).toEqual(['imported words', 'a new note']);
		const text = buildGedcom551String(await getTreeExportData(t.d1, treeId));
		expect(text).toContain('2 NOTE imported words');
		expect(text).toContain('2 NOTE a new note');
		expect(
			(await t.db.select().from(events).where(eq(events.id, fact.id)).get())!.description
		).toBeNull();
	});
});

describe('the name-change note and a name’s own notes (ADR-013, ADR-029)', () => {
	const FILE = `0 HEAD
1 GEDC
2 VERS 5.5.1
0 @I1@ INDI
1 NAME Ann /Ash/
1 NAME Ann /Birch/
2 TYPE married
2 NOTE Took his surname
2 NOTE Name in use from 1925, through family @F1@.
0 @I2@ INDI
1 NAME Bob /Birch/
0 @F1@ FAM
1 HUSB @I2@
1 WIFE @I1@
0 TRLR`;

	it('keeps both after an import, an edit and an export', async () => {
		const actor = await createTestUser(t.db);
		const treeId = await createTestTree(t.db, actor);
		await importGedcomToDb(t.d1, treeId, FILE, 'Names', 'merge');
		const married = (await t.db.select().from(personNames).all()).find(
			(n) => n.personId === `${treeId}:@I1@` && n.type === 'married'
		)!;
		// Imported: the change note is the name's columns, and the person's own note is a note record.
		expect(married).toMatchObject({ dateRaw: '1925', unionId: `${treeId}:@F1@` });
		const own = (await t.db.select().from(noteAttachments).all()).filter(
			(a) => a.subjectId === married.id
		);
		expect(own.map((a) => a.text)).toEqual(['Took his surname']);

		// Edited: another user note on the name, and the name's own fields.
		await new NoteService(t.db).addNote(
			treeId,
			{ kind: 'name', id: married.id },
			'Changed again in 1950',
			actor.context
		);
		await new NameService(t.db).update(
			treeId,
			married.id,
			{ givenName: 'Annie' },
			married.version,
			actor.context
		);

		// Exported: all three notes, once each, in both dialects.
		for (const build of [buildGedcom551String, buildGedcom7String]) {
			const text = build(await getTreeExportData(t.d1, treeId));
			const married551 = text.split('\r\n').filter((l) => /NOTE/.test(l));
			expect(
				married551.filter((l) => l === '2 NOTE Name in use from 1925, through family @F1@.')
			).toHaveLength(1);
			expect(married551).toContain('2 NOTE Took his surname');
			expect(married551).toContain('2 NOTE Changed again in 1950');
		}
	});
});

describe('notes follow what they are on', () => {
	const FILE = `0 HEAD
1 GEDC
2 VERS 5.5.1
0 @N1@ NOTE shared on both
0 @I1@ INDI
1 NAME Ann /Ash/
1 NOTE ann person note
1 BIRT
2 DATE 1900
2 NOTE ann birth note
1 FAMC @F0@
2 NOTE ann link note
0 @I2@ INDI
1 NAME Ann /Ash/
1 NOTE ann twin person note
1 NOTE @N1@
1 BIRT
2 DATE 1900
2 NOTE twin birth note
1 FAMC @F0@
2 NOTE twin link note
0 @I3@ INDI
1 NAME Pa /Ash/
1 FAMS @F0@
0 @F0@ FAM
1 HUSB @I3@
1 CHIL @I1@
1 CHIL @I2@
0 TRLR`;

	it('are carried by a person merge, counted in its preview, and returned by undo', async () => {
		const { PersonMergeService } = await import('./person-merge-service');
		const actor = await createTestUser(t.db);
		const treeId = await createTestTree(t.db, actor);
		await importGedcomToDb(t.d1, treeId, FILE, 'People', 'merge');
		const rows = async () => {
			const { ChangeStore } = await import('../repositories/change-store');
			return new ChangeStore(t.db).loadRows(treeId);
		};
		const before = (await rows()).noteAttachments.map((a) => a.text ?? a.noteId).sort();
		const merge = new PersonMergeService(t.db);
		const request = { survivorId: `${treeId}:@I1@`, mergedId: `${treeId}:@I2@` };

		const preview = await merge.preview(treeId, request, actor.context);
		expect(preview.carriedNotes).toBe(4);
		const review = await merge.review(treeId, request, actor.context);
		expect(review.notes.join(' ')).toContain('4 notes of the other record');

		await merge.merge(treeId, request, actor.context);
		const after = await rows();
		// None dropped; every note sits on a record that still exists, a duplicated fact or link hands its note over.
		expect(after.noteAttachments.map((a) => a.text ?? a.noteId).sort()).toEqual(before);
		const owners = {
			person: after.individuals,
			name: after.personNames,
			event: after.events,
			union: after.unions,
			parent_child: after.parentChild
		} as Record<string, Array<{ id: string }>>;
		for (const a of after.noteAttachments)
			expect(
				owners[a.subjectKind].some((r) => r.id === a.subjectId),
				a.text ?? ''
			).toBe(true);

		await new ChangeLogService(t.db).undoLast(treeId, actor.context);
		expect((await rows()).noteAttachments.map((a) => a.text ?? a.noteId).sort()).toEqual(before);
	});

	it('are carried by a partnership merge: a fact’s note goes with the fact that is kept, or to the partnership', async () => {
		const { RelationshipService } = await import('./relationship-service');
		const { ChangeStore } = await import('../repositories/change-store');
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
1 NOTE f1 note
1 MARR
2 DATE 1900
2 NOTE f1 marr note
0 @F2@ FAM
1 HUSB @I1@
1 WIFE @I2@
1 NOTE f2 note
1 MARR
2 DATE 1900
2 NOTE f2 marr note
1 DIV
2 DATE 1920
2 NOTE f2 div note
0 @F3@ FAM
1 HUSB @I1@
1 WIFE @I2@
1 MARR
2 DATE 1905
2 NOTE f3 marr note
0 TRLR`;
		await importGedcomToDb(t.d1, treeId, file, 'Unions', 'merge');
		const texts = async () =>
			(await new ChangeStore(t.db).loadRows(treeId)).noteAttachments.map((a) => a.text).sort();
		const before = await texts();
		expect(before).toHaveLength(6);

		const service = new RelationshipService(t.db);
		const f1 = `${treeId}:@F1@`;
		// F2 ended in a divorce and F1 did not: F1's status is kept; F3 has a different marriage, which is not.
		const command = {
			kind: 'merge_unions' as const,
			survivorId: f1,
			mergedIds: [`${treeId}:@F2@`, `${treeId}:@F3@`],
			keep: { status: f1, events: { MARR: f1 } }
		};
		const preview = await service.previewMerge(treeId, command, actor.context);
		expect(preview.impact?.carriedNotes).toBe(4);
		await service.mergeUnions(treeId, command, actor.context);
		expect(await texts()).toEqual(before);
		const stored = await new ChangeStore(t.db).loadRows(treeId);
		// Both marriages F1 did not keep hand their notes to the partnership itself, beside its own;
		// the one F1 kept keeps its own.
		const marriage = stored.events.find((e) => e.entityId === f1 && e.type === 'MARR')!;
		const on = (kind: string, id: string) =>
			stored.noteAttachments
				.filter((a) => a.subjectKind === kind && a.subjectId === id)
				.map((a) => a.text)
				.sort();
		expect(on('event', marriage.id)).toEqual(['f1 marr note']);
		expect(on('union', f1)).toEqual(['f1 note', 'f2 marr note', 'f2 note', 'f3 marr note']);
		const divorce = stored.events.find((e) => e.entityId === f1 && e.type === 'DIV')!;
		expect(on('event', divorce.id)).toEqual(['f2 div note']);
		const text = buildGedcom551String(await getTreeExportData(t.d1, treeId));
		for (const note of before) expect(text).toContain(`NOTE ${note}`);
		await new ChangeLogService(t.db).undoLast(treeId, actor.context);
		expect(await texts()).toEqual(before);
	});

	it('are removed with a deleted fact and restored with it by undo', async () => {
		const { treeId, ctx, service, facts, birthId, noteOf, log } = await setup();
		await service.addNote(treeId, { kind: 'event', id: birthId }, 'a birth note', ctx);
		const birth = (await t.db.select().from(events).where(eq(events.id, birthId)).get())!;
		await facts.remove(treeId, birthId, birth.version, ctx);
		expect(await noteOf(birthId)).toEqual([]);
		await log.undoLast(treeId, ctx);
		expect((await noteOf(birthId)).map((n) => n.text)).toEqual(['a birth note']);
	});

	it('follow a source that is merged away, and a citation that is deleted with its source', async () => {
		const { treeId, ctx, service, birthId, log } = await setup();
		const evidence = new EvidenceService(t.db);
		const keep = await evidence.createSource(treeId, { title: 'Keep' }, ctx);
		const fold = await evidence.createSource(treeId, { title: 'Fold' }, ctx);
		await service.addNote(treeId, { kind: 'source', id: fold.sourceId }, 'about fold', ctx);
		const cited = await evidence.addCitation(
			treeId,
			{ kind: 'event', id: birthId },
			{ sourceId: fold.sourceId, page: 'p 1' },
			ctx
		);
		await service.addNote(
			treeId,
			{ kind: 'citation', id: cited.citationId },
			'about the citation',
			ctx
		);

		await evidence.mergeSources(treeId, keep.sourceId, [fold.sourceId], undefined, ctx);
		const all = async () =>
			(await t.db.select().from(noteAttachments).all()).filter((a) => a.treeId === treeId);
		expect((await all()).map((a) => [a.subjectKind, a.text]).sort()).toEqual([
			['citation', 'about the citation'],
			['source', 'about fold']
		]);
		expect((await all()).find((a) => a.subjectKind === 'source')!.subjectId).toBe(keep.sourceId);

		await evidence.deleteSource(treeId, keep.sourceId, { shouldRemoveCitations: true }, ctx);
		expect(await all()).toEqual([]);
		await log.undoLast(treeId, ctx);
		expect(await all()).toHaveLength(2);
	});
});
