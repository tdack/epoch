/**
 * Notes are records, not retained lines (ADR-029): shared notes and the notes under a structure are
 * in their tables, in the order the file gave, and a file still comes back whole from them in both
 * dialects. The bar is the evidence round trip's: every line of the file is written, root records
 * once, and importing again changes nothing.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asc, eq } from 'drizzle-orm';
import NOTES7 from './fixtures/notes7.ged?raw';
import {
	citations,
	events,
	individuals,
	noteAttachments,
	notes,
	parentChild,
	personNames,
	repositories,
	sources
} from '../db/schema';
import { createTestDatabase, type TestDatabase } from '../testing/d1';
import { getTreeExportData, importGedcomToDb } from '../testing/gedcom';
import { buildGedcom551String, buildGedcom7String } from './serializer';
import { parseGedcom } from './parser';

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
const exportOf = async (treeId: string, format: '551' | '7' = '7') => {
	const data = await getTreeExportData(t.d1, treeId);
	return lines(format === '551' ? buildGedcom551String(data) : buildGedcom7String(data));
};

/** A tree's notes in the order they sit, each named by what it is on. */
async function attachmentsOf(treeId: string) {
	const noteRows = await t.db.select().from(notes).where(eq(notes.treeId, treeId)).all();
	const xrefOf = new Map(noteRows.map((n) => [n.id, n.xref]));
	const label = new Map<string, string>();
	for (const p of await t.db.select().from(individuals).where(eq(individuals.treeId, treeId)).all())
		label.set(`person|${p.id}`, `person ${p.xrefId}`);
	for (const e of await t.db.select().from(events).where(eq(events.treeId, treeId)).all())
		label.set(`event|${e.id}`, `${e.type} ${e.entityId.replace(`${treeId}:`, '')}`);
	for (const n of (await t.db.select().from(personNames).all()).filter((x) =>
		x.personId.startsWith(`${treeId}:`)
	))
		label.set(`name|${n.id}`, `name ${n.givenName}`);
	for (const s of await t.db.select().from(sources).where(eq(sources.treeId, treeId)).all())
		label.set(`source|${s.id}`, `source ${s.xref}`);
	for (const r of await t.db
		.select()
		.from(repositories)
		.where(eq(repositories.treeId, treeId))
		.all())
		label.set(`repository|${r.id}`, `repository ${r.xref}`);
	for (const c of await t.db.select().from(citations).where(eq(citations.treeId, treeId)).all())
		label.set(`citation|${c.id}`, `citation ${c.page}`);
	for (const u of await t.db.select().from(parentChild).where(eq(parentChild.treeId, treeId)).all())
		label.set(`parent_child|${u.id}`, 'link');
	const rows = await t.db
		.select()
		.from(noteAttachments)
		.where(eq(noteAttachments.treeId, treeId))
		.orderBy(asc(noteAttachments.sortOrder))
		.all();
	const by = new Map<string, string[]>();
	for (const a of rows) {
		const subject =
			label.get(`${a.subjectKind}|${a.subjectId}`) ??
			`${a.subjectKind} ${a.subjectId.replace(`${treeId}:`, '')}`;
		const what = a.noteId ? `-> ${xrefOf.get(a.noteId)}` : (a.text ?? `-> ${a.noteRef}`);
		by.set(subject, [...(by.get(subject) ?? []), what]);
	}
	return Object.fromEntries([...by].sort(([a], [b]) => (a < b ? -1 : 1)));
}

describe('a GEDCOM 7 file with SNOTE, MIME and LANG', () => {
	it('models each shared note once, with its words, MIME, LANG and the lines it keeps', async () => {
		const treeId = crypto.randomUUID();
		await importGedcomToDb(t.d1, treeId, NOTES7, 'Notes');
		const rows = await t.db.select().from(notes).where(eq(notes.treeId, treeId)).all();
		const one = rows.find((n) => n.xref === '@N1@')!;
		expect(one).toMatchObject({
			text: 'Shared note one\nsecond linecontinued',
			mime: 'text/html',
			language: 'en-AU',
			gedcomTag: 'SNOTE',
			gedcomExtra: ['1 _NCUSTOM kept']
		});
		expect(rows.find((n) => n.xref === '@N2@')).toMatchObject({
			text: 'Plain shared note',
			mime: null,
			language: null
		});
		expect(rows).toHaveLength(2);
	});

	it('puts every note on the subject it was under, in file order, as text or as a pointer', async () => {
		const treeId = crypto.randomUUID();
		await importGedcomToDb(t.d1, treeId, NOTES7, 'Notes');
		expect(await attachmentsOf(treeId)).toEqual({
			'person @I1@': ['person inline\nmore wordsand a tail', '-> @N1@'],
			'BIRT @I1@': ['before the citation', '-> @N2@', 'after the citation'],
			'name Ann': ['name note'],
			'source @S1@': ['-> @N1@', 'source inline note'],
			'repository @R1@': ['repository note'],
			'citation p 1': ['note on a citation', '-> @N2@'],
			'MARR @F1@': ['marriage note', '-> @N1@'],
			link: ['link note'],
			'union @F1@': ['family note']
		});
	});

	it('keeps the header note out of the tree: it is the file’s, not the tree’s', async () => {
		const treeId = crypto.randomUUID();
		await importGedcomToDb(t.d1, treeId, NOTES7, 'Notes');
		const text = (await exportOf(treeId)).join('\n');
		expect(text).not.toContain('header note');
		expect(Object.values(await attachmentsOf(treeId)).flat()).not.toContain('header note');
	});

	it('writes every non-header line of the file, in 7.0, with SNOTE for the records it came as', async () => {
		const treeId = crypto.randomUUID();
		await importGedcomToDb(t.d1, treeId, NOTES7, 'Notes');
		const out = await exportOf(treeId, '7');
		const body = new Set(withoutHeader(out));
		const missing = withoutHeader(lines(NOTES7)).filter(
			(line) => line !== '1 NOTE header note' && !body.has(line)
		);
		expect(missing).toEqual([]);
		for (const record of ['0 @N1@ SNOTE Shared note one', '0 @N2@ SNOTE Plain shared note'])
			expect(out.filter((line) => line === record)).toHaveLength(1);
		expect(out).not.toContain('0 @N1@ NOTE Shared note one');
	});

	it('keeps a note’s CONT and CONC exactly as the file split it', async () => {
		const treeId = crypto.randomUUID();
		await importGedcomToDb(t.d1, treeId, NOTES7, 'Notes');
		const out = (await exportOf(treeId)).join('\n');
		expect(out).toContain('0 @N1@ SNOTE Shared note one\n1 CONT second line\n1 CONC  continued\n');
		expect(out).toContain('1 NOTE person inline\n2 CONT more words\n2 CONC  and a tail');
	});

	it('writes a pointer as NOTE in 5.5.1 and SNOTE in 7.0, to the one record', async () => {
		const treeId = crypto.randomUUID();
		await importGedcomToDb(t.d1, treeId, NOTES7, 'Notes');
		const old = (await exportOf(treeId, '551')).join('\n');
		expect(old).not.toContain('SNOTE');
		expect(old).toContain('1 NOTE @N1@');
		expect(old).toContain('0 @N1@ NOTE Shared note one');
		const modern = (await exportOf(treeId, '7')).join('\n');
		expect(modern).toContain('1 SNOTE @N1@');
		expect(modern).not.toMatch(/\d NOTE @N1@/);
	});

	it('reads its own 5.5.1 export back into the same notes', async () => {
		const treeId = crypto.randomUUID();
		await importGedcomToDb(t.d1, treeId, NOTES7, 'Notes');
		const text = (await exportOf(treeId, '551')).join('\n');
		const again = crypto.randomUUID();
		await importGedcomToDb(t.d1, again, text, 'Again');
		expect(await attachmentsOf(again)).toEqual(await attachmentsOf(treeId));
		const first = await t.db.select().from(notes).where(eq(notes.treeId, treeId)).all();
		const second = await t.db.select().from(notes).where(eq(notes.treeId, again)).all();
		expect(second.map((n) => [n.xref, n.text, n.mime, n.language]).sort()).toEqual(
			first.map((n) => [n.xref, n.text, n.mime, n.language]).sort()
		);
	});
});

describe('notes among citations and other lines', () => {
	it('keeps notes in their order beside citations in theirs', () => {
		const parsed = parseGedcom(`0 HEAD
1 GEDC
2 VERS 5.5.1
0 @I1@ INDI
1 NAME A /B/
1 BIRT
2 NOTE one
2 SOUR @S1@
3 PAGE a
2 NOTE two
2 SOUR @S1@
3 PAGE b
2 NOTE three
0 TRLR`);
		const [birth] = parsed.individuals[0].events;
		expect(birth.noteLinks?.map((n) => n.text)).toEqual(['one', 'two', 'three']);
		expect(birth.citations?.map((c) => c.page)).toEqual(['a', 'b']);
	});

	it('writes them back in those orders after an import and an export', async () => {
		const ged = `0 HEAD
1 GEDC
2 VERS 5.5.1
0 @I1@ INDI
1 NAME A /B/
1 BIRT
2 NOTE one
2 SOUR @S1@
3 PAGE a
2 NOTE two
2 SOUR @S1@
3 PAGE b
2 NOTE three
0 @S1@ SOUR
1 TITL T
0 TRLR`;
		const treeId = crypto.randomUUID();
		await importGedcomToDb(t.d1, treeId, ged, 'Order');
		const out = (await exportOf(treeId, '551')).join('\n');
		const notesInOrder = [...out.matchAll(/2 NOTE (\w+)/g)].map((m) => m[1]);
		const pagesInOrder = [...out.matchAll(/3 PAGE (\w+)/g)].map((m) => m[1]);
		expect(notesInOrder).toEqual(['one', 'two', 'three']);
		expect(pagesInOrder).toEqual(['a', 'b']);
	});
});

describe('importing again changes nothing', () => {
	it('exports the same file twice, and after a replace and a merge re-import', async () => {
		const treeId = crypto.randomUUID();
		await importGedcomToDb(t.d1, treeId, NOTES7, 'Notes');
		const first = withoutHeader(await exportOf(treeId));
		expect(withoutHeader(await exportOf(treeId))).toEqual(first);
		const attached = await attachmentsOf(treeId);

		await importGedcomToDb(t.d1, treeId, NOTES7, 'Notes', 'replace');
		expect(withoutHeader(await exportOf(treeId))).toEqual(first);
		expect(await attachmentsOf(treeId)).toEqual(attached);

		await importGedcomToDb(t.d1, treeId, NOTES7, 'Notes', 'merge');
		expect(withoutHeader(await exportOf(treeId))).toEqual(first);
		expect(await attachmentsOf(treeId)).toEqual(attached);
		expect(await t.db.select().from(notes).where(eq(notes.treeId, treeId)).all()).toHaveLength(2);
	});

	it('adds only what a second file brings: a new note on a fact the tree already has', async () => {
		const treeId = crypto.randomUUID();
		await importGedcomToDb(t.d1, treeId, NOTES7, 'Notes');
		const more = NOTES7.replace(
			'2 NOTE marriage note\n',
			'2 NOTE marriage note\n2 NOTE a second file’s note\n'
		).replace(
			'0 @N2@ SNOTE Plain shared note\n',
			'0 @N2@ SNOTE Plain shared note\n0 @N3@ SNOTE A new shared note\n'
		);
		await importGedcomToDb(t.d1, treeId, more, 'Notes', 'merge');
		const attached = await attachmentsOf(treeId);
		expect(attached['MARR @F1@']).toEqual(['marriage note', '-> @N1@', 'a second file’s note']);
		expect(
			(await t.db.select().from(notes).where(eq(notes.treeId, treeId)).all())
				.map((n) => n.xref)
				.sort()
		).toEqual(['@N1@', '@N2@', '@N3@']);
		// Everything else is as it was.
		expect(attached['BIRT @I1@']).toEqual(['before the citation', '-> @N2@', 'after the citation']);
	});

	it('keeps two identical notes on one fact as two notes, and the same pair on a re-import as two', async () => {
		const ged = `0 HEAD
1 GEDC
2 VERS 5.5.1
0 @I1@ INDI
1 NAME A /B/
1 OCCU Smith
2 NOTE same
2 NOTE same
0 TRLR`;
		const treeId = crypto.randomUUID();
		await importGedcomToDb(t.d1, treeId, ged, 'Twins');
		await importGedcomToDb(t.d1, treeId, ged, 'Twins', 'merge');
		expect((await attachmentsOf(treeId))['OCCU @I1@']).toEqual(['same', 'same']);
	});
});
