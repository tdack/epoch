/**
 * The 7.0 export of Epoch's own fixtures, which carry 5.5.1 lines as they were written, holds none of
 * the errors the dialect rewrites exist to remove, and a 7.0 export read back is exported unchanged.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../testing/d1';
import { getTreeExportData, importGedcomToDb, withoutStamps } from '../testing/gedcom';
import EVIDENCE from './fixtures/evidence.ged?raw';
import NOTES7 from './fixtures/notes7.ged?raw';
import SOURCES7 from './fixtures/sources7.ged?raw';
import { parseGedcom } from './parser';
import { buildGedcom7String } from './serializer';
import { validateGedcom7 } from './validate7';

let t: TestDatabase;
beforeAll(async () => {
	t = await createTestDatabase();
});
afterAll(async () => {
	await t.dispose();
});

async function export7(source: string): Promise<string> {
	const treeId = crypto.randomUUID();
	await importGedcomToDb(t.d1, treeId, source, 'Dialect');
	return buildGedcom7String(await getTreeExportData(t.d1, treeId));
}

/** The error codes the rewrites remove: a shared NOTE, an inline SOUR, FAMC.SOUR, a FILE with no FORM. */
const FIXED_CODES = new Set([
	'cardinality-min',
	'payload-unexpected',
	'pointer-format',
	'root-tag-unknown',
	'tag-not-allowed'
]);

describe.each([
	['evidence.ged', EVIDENCE],
	['sources7.ged', SOURCES7],
	['notes7.ged', NOTES7]
])('the 7.0 export of %s', (_name, source) => {
	it('has none of the errors the dialect rewrites fix', async () => {
		const errors = validateGedcom7(await export7(source)).errors.filter((e) =>
			FIXED_CODES.has(e.code)
		);
		expect(errors.map((e) => `${e.code} ${e.path}`)).toEqual([]);
	});

	it('is exported unchanged after it is imported again', async () => {
		const once = await export7(source);
		const twice = await export7(once);
		// A made record is a real source the second time, so it moves among the records; the lines stay.
		const body = (text: string) =>
			text
				.slice(text.indexOf('\r\n0 @'))
				.replace(/@[0-9a-f-]{36}@/g, '@U@')
				.split('\r\n');
		// Epoch's own CHAN/CREA differ between the two exports, and a made record gains one.
		const sorted = (text: string) => withoutStamps(body(text)).sort();
		expect(sorted(twice)).toEqual(sorted(once));
	});
});

describe('the 7.0 export of evidence.ged', () => {
	it('writes the shared note as SNOTE, the inline source as a record and the file with a FORM', async () => {
		const text = await export7(EVIDENCE);
		expect(text).toContain('0 @N1@ SNOTE Shared note text');
		expect(text).not.toMatch(/^1 NOTE @N1@/m);
		expect(text).toMatch(/^1 SOUR @SOUR_[0-9A-F]{8}@$/m);
		expect(text).toMatch(/^0 @SOUR_[0-9A-F]{8}@ SOUR\r\n1 TITL inline citation text$/m);
		expect(text).toContain('1 FILE a.png\r\n2 FORM image/png');
	});

	it('writes the citation on a FAMC link as _SOUR, documents it, and reads it back as a citation', async () => {
		const text = await export7(EVIDENCE);
		expect(text).toMatch(/^1 FAMC @[^@]+@\r\n2 _SOUR @S1@\r\n3 PAGE famc page/m);
		expect(text).toContain('2 TAG _SOUR ');
		const parsed = parseGedcom(text);
		const child = parsed.individuals.find((i) => i.famcLinks?.length);
		expect(child?.famcLinks?.[0].citations.map((c) => c.page)).toEqual(['famc page']);
	});
});
