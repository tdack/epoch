/**
 * A tree imported from 5.5.1 and exported as 7.0, the default since 7.0 became it. The file
 * carries lines kept verbatim from the 5.5.1 import as well as built ones, and every line has to be
 * valid 7.0, not only the ones the serializer writes.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../testing/d1';
import { getTreeExportData, importGedcomToDb } from '../testing/gedcom';
import EVIDENCE from './fixtures/evidence.ged?raw';
import { parseGedcom } from './parser';
import { buildGedcom7String } from './serializer';

let t: TestDatabase;
beforeAll(async () => {
	t = await createTestDatabase();
});
afterAll(async () => {
	await t.dispose();
});

const DATES_551 = `0 HEAD
1 GEDC
2 VERS 5.5.1
2 FORM LINEAGE-LINKED
1 CHAR UTF-8
0 @I1@ INDI
1 NAME Ann /Ash/
1 SEX F
1 _EPOCH_PRIVACY public
1 BIRT
2 DATE 30 JAN 1648/49
1 BAPM
2 DATE @#DJULIAN@ 2 FEB 1649
1 DEAT
2 DATE INT 1700 (at the turn of the century)
1 BURI
2 DATE (after the war)
1 RESI
2 DATE Spring 1690
2 NOTE @ann on the old forum
3 CONC  and elsewhere
1 FAMC @F1@
2 PEDI adopted
0 @I2@ INDI
1 NAME Bo /Ash/
1 FAMS @F1@
0 @I3@ INDI
1 NAME Cy /Ash/
1 FAMS @F1@
0 @F1@ FAM
1 HUSB @I2@
1 WIFE @I3@
1 CHIL @I1@
1 MARR
2 DATE 44 B.C.
0 TRLR
`;

const lines = (text: string) => text.split(/\r?\n/).filter(Boolean);

async function exportAs7(ged: string): Promise<string> {
	const treeId = crypto.randomUUID();
	await importGedcomToDb(t.d1, treeId, ged, 'Converted');
	return buildGedcom7String(await getTreeExportData(t.d1, treeId));
}

/** What a 7.0 reader would reject among these lines. */
function invalid7Lines(text: string): string[] {
	return lines(text).filter((line) => {
		const [, , tag, payload] = line.match(/^(\d+) (?:@[^@\s]+@ )?(\S+)(?: (.*))?$/) ?? [];
		if (!tag) return true;
		if (tag === 'CONC' || tag === 'CHAR') return true;
		if (tag === 'DATE' && payload && /@#D|\/\d|B\.C\.|\(|^INT /.test(payload)) return true;
		if (tag === 'TAG' && !payload?.startsWith('_')) return true;
		return !!payload?.startsWith('@') && !payload.startsWith('@@') && !/^@[^@\s]+@$/.test(payload);
	});
}

describe('a 5.5.1 tree exported as 7.0', () => {
	it.each([
		['the evidence fixture', EVIDENCE],
		['a file of 5.5.1-only dates, text and tags', DATES_551]
	])('writes only valid 7.0 lines for %s', async (_name, ged) => {
		expect(invalid7Lines(await exportAs7(ged))).toEqual([]);
	});

	it('converts each date, keeping what 7.0 cannot say as a PHRASE', async () => {
		const text = lines(await exportAs7(DATES_551)).join('\n');
		expect(text).toContain('2 DATE 30 JAN 1649\n3 PHRASE 30 JAN 1648/49');
		expect(text).toContain('2 DATE JULIAN 2 FEB 1649\n');
		expect(text).toContain('2 DATE 1700\n3 PHRASE at the turn of the century');
		expect(text).toContain('2 DATE\n3 PHRASE after the war');
		expect(text).toContain('2 DATE\n3 PHRASE Spring 1690');
		expect(text).toContain('2 DATE 44 BCE');
		expect(text).toContain('2 NOTE @@ann on the old forum and elsewhere');
	});

	it('documents the Epoch tags it uses in SCHMA, right after GEDC', async () => {
		const head = lines(await exportAs7(DATES_551)).slice(0, 6);
		expect(head.slice(0, 5)).toEqual([
			'0 HEAD',
			'1 GEDC',
			'2 VERS 7.0',
			'1 SCHMA',
			'2 TAG _EPOCH_PRIVACY https://github.com/tdack/epoch/blob/main/docs/gedcom-extensions.md#_epoch_privacy'
		]);
	});

	it('reads its own 7.0 export back with the same dates and text', async () => {
		const first = parseGedcom(DATES_551);
		const again = parseGedcom(await exportAs7(DATES_551));
		const datesOf = (parsed: typeof first) =>
			parsed.individuals.find((i) => i.id === '@I1@')!.events.map((e) => [e.type, e.dateSort]);
		// A dual year's later year is the Gregorian one, as 7.0 writes it. Epoch's own reading of
		// `1648/49` sorts on the earlier year, so the birth moves to where it belongs.
		const [birth, ...rest] = datesOf(again);
		expect(birth).toEqual(['BIRT', '1649-01-30']);
		expect(rest).toEqual(datesOf(first).slice(1));
		expect(again.individuals.find((i) => i.id === '@I1@')!.events.map((e) => e.dateRaw)).toEqual([
			'INT 30 JAN 1649 (30 JAN 1648/49)',
			'JULIAN 2 FEB 1649',
			'INT 1700 (at the turn of the century)',
			'(after the war)',
			'(Spring 1690)'
		]);
	});
});
