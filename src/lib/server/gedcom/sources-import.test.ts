/**
 * Sources, repositories and citations are records, not retained lines (ADR-028): what the model can
 * hold is in its tables, in the order the file gave, and a file still comes back whole from them.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asc, eq } from 'drizzle-orm';
import EVIDENCE from './fixtures/evidence.ged?raw';
import SOURCES7 from './fixtures/sources7.ged?raw';
import { citations, events, repositories, sourceRepositories, sources } from '../db/schema';
import { createTestDatabase, type TestDatabase } from '../testing/d1';
import { getTreeExportData, importGedcomToDb } from '../testing/gedcom';
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
const exportOf = async (treeId: string, format: '551' | '7' = '7') => {
	const data = await getTreeExportData(t.d1, treeId);
	return lines(format === '551' ? buildGedcom551String(data) : buildGedcom7String(data));
};

const citationsOf = (treeId: string) =>
	t.db
		.select()
		.from(citations)
		.where(eq(citations.treeId, treeId))
		.orderBy(asc(citations.sortOrder))
		.all();

describe('a GEDCOM 7 file with citations', () => {
	it('models the sources, repository and link, with the call number on the link', async () => {
		const treeId = crypto.randomUUID();
		await importGedcomToDb(t.d1, treeId, SOURCES7, 'Sources');
		const rows = await t.db.select().from(sources).where(eq(sources.treeId, treeId)).all();
		expect(rows.map((s) => [s.xref, s.title, s.abbreviation]).sort()).toEqual([
			['@S1@', 'Parish register', 'PR'],
			['@S2@', 'Census 1901', null]
		]);
		const [repository] = await t.db
			.select()
			.from(repositories)
			.where(eq(repositories.treeId, treeId))
			.all();
		expect(repository).toMatchObject({
			xref: '@R1@',
			name: 'County Archive',
			address: '1 High St\nYork'
		});
		const links = await t.db.select().from(sourceRepositories).all();
		expect(links.filter((l) => l.repositoryId === repository.id)).toMatchObject([
			{ callNumber: 'A-1', sourceId: `${treeId}:@S1@` }
		]);
	});

	it('keeps the order of a fact’s citations', async () => {
		const treeId = crypto.randomUUID();
		await importGedcomToDb(t.d1, treeId, SOURCES7, 'Sources');
		const [birth] = await t.db
			.select()
			.from(events)
			.where(eq(events.entityId, `${treeId}:@I1@`))
			.all();
		const onBirth = (await citationsOf(treeId)).filter((c) => c.subjectId === birth.id);
		expect(onBirth.map((c) => c.page)).toEqual(['first', 'second', 'third']);
		expect(onBirth.map((c) => c.sortOrder)).toEqual([0, 1, 2]);
	});

	it('reads QUAY and an approximate DATA.DATE without making it an exact day', async () => {
		const treeId = crypto.randomUUID();
		await importGedcomToDb(t.d1, treeId, SOURCES7, 'Sources');
		const onPerson = (await citationsOf(treeId)).filter((c) => c.subjectKind === 'person');
		expect(onPerson.map((c) => c.page)).toEqual(['12', '99']);
		expect(onPerson[0]).toMatchObject({
			quality: 3,
			entryDateRaw: 'ABT 1901',
			entryDateQualifier: 'ABOUT',
			entryDatePrecision: 'YEAR',
			text: 'As written'
		});
	});

	it('writes the same citations back in both versions, then the same file again', async () => {
		const treeId = crypto.randomUUID();
		await importGedcomToDb(t.d1, treeId, SOURCES7, 'Sources');
		const body = new Set(withoutHeader(await exportOf(treeId, '7')));
		expect(withoutHeader(lines(SOURCES7)).filter((line) => !body.has(line))).toEqual([]);

		const first = await exportOf(treeId, '7');
		const again = crypto.randomUUID();
		await importGedcomToDb(t.d1, again, first.join('\n'), 'Sources');
		expect(withoutHeader(await exportOf(again, '7'))).toEqual(withoutHeader(first));
		const asOld = await exportOf(treeId, '551');
		expect(asOld.filter((l) => l === '0 @S1@ SOUR')).toHaveLength(1);
	});
});

describe('citations without a source record', () => {
	it('keeps a pointerless citation as inline text and a dangling pointer as written', async () => {
		const treeId = crypto.randomUUID();
		await importGedcomToDb(t.d1, treeId, EVIDENCE, 'Evidence');
		const all = await citationsOf(treeId);
		const inline = all.find((c) => c.description === 'inline citation text');
		expect(inline).toMatchObject({ sourceId: null, sourceRef: null, subjectKind: 'person' });
		const dangling = all.find((c) => c.sourceRef === '@MISSING@');
		expect(dangling).toMatchObject({ sourceId: null, subjectKind: 'event' });
		const out = await exportOf(treeId, '551');
		expect(out).toContain('1 SOUR inline citation text');
		expect(out).toContain('2 SOUR @MISSING@');
	});

	it('keeps what a citation holds that the model does not (OBJE, a custom tag)', async () => {
		const treeId = crypto.randomUUID();
		await importGedcomToDb(t.d1, treeId, EVIDENCE, 'Evidence');
		const onPerson = (await citationsOf(treeId)).find(
			(c) => c.subjectKind === 'person' && c.page === 'p. 12'
		);
		expect(onPerson?.gedcomExtra).toEqual(['2 OBJE @M1@', '2 _CITCUSTOM x']);
	});
});

describe('importing again', () => {
	const counts = async (treeId: string) => ({
		sources: (await t.db.select().from(sources).where(eq(sources.treeId, treeId)).all()).length,
		repositories: (
			await t.db.select().from(repositories).where(eq(repositories.treeId, treeId)).all()
		).length,
		citations: (await citationsOf(treeId)).length
	});

	it('writes no record twice on a replace or a merge import', async () => {
		const treeId = crypto.randomUUID();
		await importGedcomToDb(t.d1, treeId, SOURCES7, 'Sources');
		const first = await counts(treeId);
		const exported = withoutHeader(await exportOf(treeId));
		expect(first.citations).toBe(9);

		await importGedcomToDb(t.d1, treeId, SOURCES7, 'Sources', 'replace');
		expect(await counts(treeId)).toEqual(first);
		await importGedcomToDb(t.d1, treeId, SOURCES7, 'Sources', 'merge');
		expect(await counts(treeId)).toEqual(first);
		expect(withoutHeader(await exportOf(treeId))).toEqual(exported);
	});

	it('adds a citation a second file has on a fact the tree already holds', async () => {
		const treeId = crypto.randomUUID();
		await importGedcomToDb(t.d1, treeId, SOURCES7, 'Sources');
		const more = SOURCES7.replace('3 PAGE third', '3 PAGE third\n2 SOUR @S1@\n3 PAGE fourth');
		await importGedcomToDb(t.d1, treeId, more, 'Sources', 'merge');
		const [birth] = await t.db
			.select()
			.from(events)
			.where(eq(events.entityId, `${treeId}:@I1@`))
			.all();
		const onBirth = (await citationsOf(treeId)).filter((c) => c.subjectId === birth.id);
		expect(onBirth.map((c) => c.page)).toEqual(['first', 'second', 'third', 'fourth']);
	});
});

describe('citations that differ only in quality, entry date or retained lines', () => {
	const cite = (body: string) => `1 SOUR @S1@\n2 PAGE 12${body ? `\n${body}` : ''}`;
	const FILE = [
		'0 HEAD\n1 GEDC\n2 VERS 7.0\n0 @S1@ SOUR\n1 TITL Register\n0 @I1@ INDI\n1 NAME Ann /Ash/',
		cite('2 QUAY 3'),
		cite('2 QUAY 1'),
		cite('2 QUAY 0'),
		cite('2 DATA\n3 DATE ABT 1901'),
		cite('2 DATA\n3 DATE 1902'),
		cite('2 _X one'),
		cite('2 _X two'),
		cite(''),
		// The same as the one before it, so it is written once.
		cite(''),
		'0 TRLR'
	].join('\n');

	it('keeps each one, and writes none twice on a merge import of the same file', async () => {
		const treeId = crypto.randomUUID();
		await importGedcomToDb(t.d1, treeId, FILE, 'Quality');
		const first = await citationsOf(treeId);
		expect(first.map((c) => [c.quality, c.entryDateRaw, c.gedcomExtra])).toEqual([
			[3, null, null],
			[1, null, null],
			[0, null, null],
			[null, 'ABT 1901', null],
			[null, '1902', null],
			[null, null, ['2 _X one']],
			[null, null, ['2 _X two']],
			[null, null, null]
		]);

		await importGedcomToDb(t.d1, treeId, FILE, 'Quality', 'merge');
		expect((await citationsOf(treeId)).map((c) => c.id)).toEqual(first.map((c) => c.id));
	});
});
