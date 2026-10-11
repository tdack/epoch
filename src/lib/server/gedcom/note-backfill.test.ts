/**
 * The notes backfill moves the notes a tree kept as retained lines, extra lines and a fact's `notes`
 * column into records. The bar it is held to is the evidence backfill's: a tree imported the old way
 * and then backfilled holds the same records, and writes the same file, as the same file imported
 * afresh; and running it again changes nothing. It never invents a link.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import EVIDENCE from './fixtures/evidence.ged?raw';
import NOTES7 from './fixtures/notes7.ged?raw';
import {
	citations,
	events,
	individuals,
	noteAttachments,
	notes,
	parentChild,
	personNames,
	sources
} from '../db/schema';
import { createTestDatabase, type TestDatabase } from '../testing/d1';
import {
	getTreeExportData,
	importGedcomAsRetainedNotes,
	importGedcomToDb
} from '../testing/gedcom';
import {
	NOTE_BACKFILL_QUERIES,
	noteBackfillStatements,
	type NoteBackfillInput
} from './note-backfill';
import { buildGedcom551String, buildGedcom7String } from './serializer';

let t: TestDatabase;
beforeAll(async () => {
	t = await createTestDatabase();
});
afterAll(async () => {
	await t.dispose();
});

const lines = (text: string) => text.replace(/\r\n/g, '\n').split('\n').filter(Boolean);
const withoutHeader = (all: string[]) =>
	all.slice(all.findIndex((line, i) => i > 0 && line.startsWith('0 ')));
const exportOf = async (treeId: string, format: '551' | '7') => {
	const data = await getTreeExportData(t.d1, treeId);
	return withoutHeader(
		lines(format === '551' ? buildGedcom551String(data) : buildGedcom7String(data))
	);
};

async function runBackfill(): Promise<number> {
	const input = {} as Record<string, unknown[]>;
	for (const [name, sql] of Object.entries(NOTE_BACKFILL_QUERIES))
		input[name] = (await t.d1.prepare(sql).all()).results;
	const statements = noteBackfillStatements(input as unknown as NoteBackfillInput);
	for (const statement of statements) await t.d1.prepare(statement).run();
	return statements.length;
}

/** The notes of a tree without the ids that differ between two trees: subjects are named by what they are. */
async function recordsOf(treeId: string) {
	const noteRows = await t.db.select().from(notes).where(eq(notes.treeId, treeId)).all();
	const xrefOf = new Map(noteRows.map((n) => [n.id, n.xref]));
	const people = await t.db.select().from(individuals).where(eq(individuals.treeId, treeId)).all();
	const factRows = await t.db.select().from(events).where(eq(events.treeId, treeId)).all();
	const nameRows = (await t.db.select().from(personNames).all()).filter((n) =>
		n.personId.startsWith(`${treeId}:`)
	);
	const sourceRows = await t.db.select().from(sources).where(eq(sources.treeId, treeId)).all();
	const cited = await t.db.select().from(citations).where(eq(citations.treeId, treeId)).all();
	const linkRows = await t.db
		.select()
		.from(parentChild)
		.where(eq(parentChild.treeId, treeId))
		.all();
	const subjectName = new Map<string, string>();
	for (const l of linkRows)
		subjectName.set(
			`parent_child|${l.id}`,
			`link ${l.parentId.replace(`${treeId}:`, '')}>${l.childId.replace(`${treeId}:`, '')} ${l.type}`
		);
	for (const p of people) subjectName.set(`person|${p.id}`, `person ${p.xrefId}`);
	for (const f of factRows)
		subjectName.set(`event|${f.id}`, `event ${f.type} ${f.entityId.replace(`${treeId}:`, '')}`);
	for (const n of nameRows)
		subjectName.set(`name|${n.id}`, `name ${n.givenName} ${n.surname} ${n.type}`);
	for (const s of sourceRows) subjectName.set(`source|${s.id}`, `source ${s.xref}`);
	for (const c of cited) subjectName.set(`citation|${c.id}`, `citation ${c.page} ${c.sourceRef}`);
	const attached = (await t.db.select().from(noteAttachments).all()).filter(
		(a) => a.treeId === treeId
	);
	return {
		notes: noteRows
			.map((n) =>
				JSON.stringify([
					n.xref,
					n.text,
					n.mime,
					n.language,
					n.gedcomTag,
					n.gedcomExtra,
					n.gedcomLayout
				])
			)
			.sort(),
		attachments: attached
			.map((a) =>
				JSON.stringify([
					subjectName.get(`${a.subjectKind}|${a.subjectId}`) ??
						`${a.subjectKind} ${a.subjectId.replace(`${treeId}:`, '')}`,
					a.sortOrder,
					a.noteId ? xrefOf.get(a.noteId) : a.noteRef,
					a.gedcomTag,
					a.text,
					a.gedcomExtra,
					a.gedcomLayout
				])
			)
			.sort(),
		// What the retained places still hold: nothing of a note should be left behind.
		leftNotes: [
			...factRows.map((f) => f.notes),
			...[...factRows, ...nameRows, ...sourceRows, ...cited].flatMap((r) =>
				(r.gedcomExtra ?? []).filter((l) => / S?NOTE(\s|$)/.test(l))
			)
		]
			.filter(Boolean)
			.sort()
	};
}

describe.each([
	['the evidence fixture', EVIDENCE],
	['a GEDCOM 7 file with SNOTE, MIME and LANG', NOTES7]
])('backfilling notes of %s', (_name, fixture) => {
	it('gives the same records and the same file as importing it afresh', async () => {
		const fresh = crypto.randomUUID();
		const old = crypto.randomUUID();
		await importGedcomToDb(t.d1, fresh, fixture, 'Fresh');
		await importGedcomAsRetainedNotes(t.d1, old, fixture);

		// Imported the old way, no note is a record yet, and a fact's first note is in its column.
		expect((await recordsOf(old)).notes).toEqual([]);
		expect((await recordsOf(old)).attachments).toEqual([]);
		expect((await recordsOf(old)).leftNotes.length).toBeGreaterThan(0);

		expect(await runBackfill()).toBeGreaterThan(0);

		const backfilled = await recordsOf(old);
		expect(backfilled.leftNotes).toEqual([]);
		expect(backfilled).toEqual(await recordsOf(fresh));
		expect(await exportOf(old, '551')).toEqual(await exportOf(fresh, '551'));
		expect(await exportOf(old, '7')).toEqual(await exportOf(fresh, '7'));
	});

	it('changes nothing the second time', async () => {
		const treeId = crypto.randomUUID();
		await importGedcomAsRetainedNotes(t.d1, treeId, fixture);
		await runBackfill();
		const records = await recordsOf(treeId);
		const file = await exportOf(treeId, '551');
		expect(await runBackfill()).toBe(0);
		expect(await recordsOf(treeId)).toEqual(records);
		expect(await exportOf(treeId, '551')).toEqual(file);
	});
});

describe('what the backfill does not do', () => {
	it('turns a free-text note into a note only, never into a citation or a source', async () => {
		const treeId = crypto.randomUUID();
		await importGedcomAsRetainedNotes(t.d1, treeId, NOTES7);
		const before = {
			citations: (await t.db.select().from(citations).where(eq(citations.treeId, treeId)).all())
				.length,
			sources: (await t.db.select().from(sources).where(eq(sources.treeId, treeId)).all()).length
		};
		await runBackfill();
		expect(
			(await t.db.select().from(citations).where(eq(citations.treeId, treeId)).all()).length
		).toBe(before.citations);
		expect((await t.db.select().from(sources).where(eq(sources.treeId, treeId)).all()).length).toBe(
			before.sources
		);
	});

	it('leaves an Epoch name-change note where it is, beside a note of the person’s own', async () => {
		const treeId = crypto.randomUUID();
		const file = `0 HEAD
1 GEDC
2 VERS 5.5.1
0 @I1@ INDI
1 NAME A /B/
1 NAME A /C/
2 TYPE married
2 NOTE Took his surname
2 NOTE Name in use from 1998, through family @F99@.
0 @F1@ FAM
1 WIFE @I1@
0 TRLR
`;
		await importGedcomAsRetainedNotes(t.d1, treeId, file);
		await runBackfill();
		const married = (await t.db.select().from(personNames).all()).find(
			(n) => n.personId === `${treeId}:@I1@` && n.type === 'married'
		)!;
		expect(married.gedcomExtra).toEqual(['2 NOTE Name in use from 1998, through family @F99@.']);
		const attached = (await t.db.select().from(noteAttachments).all()).filter(
			(a) => a.subjectId === married.id
		);
		expect(attached.map((a) => a.text)).toEqual(['Took his surname']);
	});
});

describe('a fact note whose text begins with an escaped @', () => {
	// The file writes `@@N1@`: an escaped leading `@`, so the note is inline text, never a pointer.
	const file = [
		'0 HEAD',
		'1 GEDC',
		'2 VERS 5.5.1',
		'0 @I1@ INDI',
		'1 NAME Ann /Ash/',
		'1 BIRT',
		'2 DATE 1 JAN 1900',
		'2 NOTE @@N1@',
		'0 TRLR'
	].join('\n');

	it('rebuilds it as inline text, not a pointer, the same as a fresh import', async () => {
		const fresh = crypto.randomUUID();
		const old = crypto.randomUUID();
		await importGedcomToDb(t.d1, fresh, file, 'Fresh');
		await importGedcomAsRetainedNotes(t.d1, old, file);

		// The old reading kept the note's payload, escaped as the file wrote it, in the fact's column.
		const [before] = await t.db.select().from(events).where(eq(events.treeId, old)).all();
		expect(before?.notes).toBe('@@N1@');

		await runBackfill();

		const [after] = await t.db.select().from(events).where(eq(events.treeId, old)).all();
		expect(after?.notes).toBeNull();
		const [attachment] = await t.db
			.select()
			.from(noteAttachments)
			.where(eq(noteAttachments.treeId, old))
			.all();
		// Inline text, not a pointer: it resolves to the text, not a noteRef.
		expect(attachment?.text).toBe('@N1@');
		expect(attachment?.noteRef).toBeNull();
		expect(await recordsOf(old)).toEqual(await recordsOf(fresh));
	});
});
