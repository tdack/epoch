/**
 * Evidence in a file (Phase 5, ADR-023): sources, repositories, shared notes and citations are not
 * modelled yet, and the rule meanwhile is the project's own: every structure a file carries comes
 * back in the file Epoch writes. This is the baseline that rule is held to, at every level a
 * citation or note can sit, and that a second import and a second export change nothing.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import FIXTURE from './fixtures/evidence.ged?raw';
import { createTestDatabase, type TestDatabase } from '../testing/d1';
import { buildGedcom551String, buildGedcom7String } from './serializer';
import { getTreeExportData, importGedcomToDb } from '../testing/gedcom';

let t: TestDatabase;
beforeAll(async () => {
	t = await createTestDatabase();
});
afterAll(async () => {
	await t.dispose();
});

const lines = (text: string) => text.replace(/\r\n/g, '\n').split('\n').filter(Boolean);
/** The header describes the file Epoch writes, not the tree, so it is Epoch's own. */
const withoutHeader = (all: string[]) =>
	all.slice(all.findIndex((line, i) => i > 0 && line.startsWith('0 ')));
const exportOf = async (treeId: string, format: '551' | '7' = '551') => {
	const data = await getTreeExportData(t.d1, treeId);
	return lines(format === '551' ? buildGedcom551String(data) : buildGedcom7String(data));
};

describe('every structure the fixture carries comes back', () => {
	it('writes every non-header line of the file, at every level', async () => {
		const treeId = crypto.randomUUID();
		await importGedcomToDb(t.d1, treeId, FIXTURE, 'Evidence');
		const body = new Set(withoutHeader(await exportOf(treeId)));
		expect(withoutHeader(lines(FIXTURE)).filter((line) => !body.has(line))).toEqual([]);
	});

	it('keeps a citation and a note inside the fact, the name and the family they were under', async () => {
		const treeId = crypto.randomUUID();
		await importGedcomToDb(t.d1, treeId, FIXTURE, 'Evidence');
		const text = (await exportOf(treeId)).join('\n');
		expect(text).toMatch(/1 BIRT\n2 DATE 1900[\s\S]*?2 SOUR @S1@\n3 PAGE birth page\n3 QUAY 2/);
		expect(text).toContain('2 NOTE birth inline note');
		expect(text).toContain('2 _EVCUSTOM y');
		expect(text).toMatch(/1 MARR\n2 DATE 1925\n2 SOUR @S1@\n3 PAGE marr page/);
		expect(text).toMatch(/1 NAME Ann \/Ash\/[\s\S]*?2 SOUR @S1@\n3 PAGE p 5/);
		expect(text).toMatch(/1 FAMC @F1@\n2 SOUR @S1@\n3 PAGE famc page/);
		// A citation of a record that is not in the file is kept as written, not dropped or invented.
		expect(text).toMatch(/1 DEAT\n2 DATE 1950\n2 SOUR @MISSING@/);
	});

	it('writes each root record once, in both versions', async () => {
		const treeId = crypto.randomUUID();
		await importGedcomToDb(t.d1, treeId, FIXTURE, 'Evidence');
		for (const format of ['551', '7'] as const) {
			const out = await exportOf(treeId, format);
			for (const record of [
				'0 @S1@ SOUR',
				'0 @R1@ REPO',
				'0 @N1@ NOTE Shared note text',
				'0 @M1@ OBJE'
			]) {
				expect(
					out.filter((line) => line === record),
					`${format}: ${record}`
				).toHaveLength(1);
			}
			expect(out.at(-1)).toBe('0 TRLR');
		}
	});
});

describe('importing again changes nothing', () => {
	it('exports the same file after a second import over the first, and a third in merge mode', async () => {
		const treeId = crypto.randomUUID();
		await importGedcomToDb(t.d1, treeId, FIXTURE, 'Evidence');
		const first = withoutHeader(await exportOf(treeId));

		await importGedcomToDb(t.d1, treeId, FIXTURE, 'Evidence', 'replace');
		expect(withoutHeader(await exportOf(treeId))).toEqual(first);

		await importGedcomToDb(t.d1, treeId, FIXTURE, 'Evidence', 'merge');
		expect(withoutHeader(await exportOf(treeId))).toEqual(first);
	});

	it('exports the same file when its own export is imported', async () => {
		const treeId = crypto.randomUUID();
		await importGedcomToDb(t.d1, treeId, FIXTURE, 'Evidence');
		const firstText = (await exportOf(treeId)).join('\n');
		const again = crypto.randomUUID();
		await importGedcomToDb(t.d1, again, firstText, 'Evidence');
		expect(withoutHeader(await exportOf(again))).toEqual(withoutHeader(firstText.split('\n')));
	});
});

/**
 * A source can have files in Epoch (ADR-061), but a GEDCOM `OBJE` carries a path, never bytes, so an
 * import creates no file and an export has no file to write. The `OBJE` under a `SOUR` stays a
 * retained line, written once; a file attached in Epoch adds nothing to the export.
 */
describe('an OBJE under a source', () => {
	const SOURCE_OBJE = `0 HEAD
0 @S1@ SOUR
1 TITL Parish register
1 OBJE @M1@
1 OBJE
2 FILE scan.png
0 @M1@ OBJE
1 FILE register.png
0 @I1@ INDI
1 NAME Ann /Ash/
0 TRLR`;

	it.each(['551', '7'] as const)('is written back once in %s', async (format) => {
		const treeId = crypto.randomUUID();
		await importGedcomToDb(t.d1, treeId, SOURCE_OBJE, 'Source OBJE');
		const out = await exportOf(treeId, format);
		const source = out.slice(out.indexOf('0 @S1@ SOUR'));
		const block = source.slice(
			0,
			source.findIndex((line, i) => i > 0 && line.startsWith('0 '))
		);
		expect(block.filter((line) => line === '1 OBJE @M1@')).toHaveLength(1);
		expect(block).toContain('1 OBJE');
		expect(block).toContain('2 FILE scan.png');
		expect(out.filter((line) => line === '0 @M1@ OBJE')).toHaveLength(1);
	});

	it('is unchanged by a file attached to the source in Epoch', async () => {
		const treeId = crypto.randomUUID();
		await importGedcomToDb(t.d1, treeId, SOURCE_OBJE, 'Source OBJE');
		const before = withoutHeader(await exportOf(treeId));
		const before7 = withoutHeader(await exportOf(treeId, '7'));
		const source = (await t.d1
			.prepare('select id from sources where tree_id = ?')
			.bind(treeId)
			.first<{
				id: string;
			}>())!;
		await t.d1
			.prepare(
				`insert into media_items (id, tree_id, r2_object_key, title, mime_type, version)
				 values (?, ?, ?, 'Scan', 'image/png', 1)`
			)
			.bind('m-1', treeId, `media/${treeId}/m-1.png`)
			.run();
		await t.d1
			.prepare(`insert into media_links (id, tree_id, media_id, entity_id) values (?, ?, 'm-1', ?)`)
			.bind(`m-1:${source.id}`, treeId, source.id)
			.run();
		expect(withoutHeader(await exportOf(treeId))).toEqual(before);
		expect(withoutHeader(await exportOf(treeId, '7'))).toEqual(before7);
	});
});
