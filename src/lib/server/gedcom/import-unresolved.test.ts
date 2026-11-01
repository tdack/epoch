/**
 * Pointers to records the file does not have. A link in the model needs a row at both ends, so a
 * pointer is only followed when the record is there; `@VOID@` is a legal 7.0 pointer, not a broken one.
 */

import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { individuals, parentChild, unions } from '../db/schema';
import { createTestDatabase, type TestDatabase } from '../testing/d1';
import { getTreeExportData, importGedcomToDb } from '../testing/gedcom';
import { parseGedcom } from './parser';
import { buildGedcom7String } from './serializer';

let t: TestDatabase;
beforeAll(async () => {
	t = await createTestDatabase();
});
afterAll(async () => {
	await t.dispose();
});

const HEAD = '0 HEAD\n1 GEDC\n2 VERS 7.0\n';
const file = (body: string) => HEAD + body + '0 TRLR\n';

/** Imports `text` into a fresh tree and answers its 7.0 export, with the rows the import wrote. */
async function roundTrip(text: string) {
	const treeId = crypto.randomUUID();
	await importGedcomToDb(t.d1, treeId, text, 'Pointers');
	return {
		treeId,
		out: buildGedcom7String(await getTreeExportData(t.d1, treeId)).replaceAll('\r\n', '\n'),
		people: await t.db.select().from(individuals).where(eq(individuals.treeId, treeId)).all(),
		unions: await t.db.select().from(unions).where(eq(unions.treeId, treeId)).all(),
		links: await t.db.select().from(parentChild).where(eq(parentChild.treeId, treeId)).all()
	};
}

const PEOPLE = '0 @I1@ INDI\n1 NAME A /B/\n0 @I2@ INDI\n1 NAME C /D/\n';

describe('a family member that is not a person of the file', () => {
	it('imports a @VOID@ child without a placeholder person and writes the line back with its PHRASE', async () => {
		const { out, people, links } = await roundTrip(
			file(PEOPLE + '0 @F1@ FAM\n1 HUSB @I1@\n1 WIFE @I2@\n1 CHIL @VOID@\n2 PHRASE Their eldest\n')
		);
		expect(people).toHaveLength(2);
		expect(links).toHaveLength(0);
		expect(out).toContain('1 CHIL @VOID@\n2 PHRASE Their eldest\n');
	});

	it('imports @VOID@ partners without dropping the partner who is there', async () => {
		const {
			out,
			people,
			unions: unionRows
		} = await roundTrip(
			file(
				PEOPLE + '0 @F1@ FAM\n1 HUSB @VOID@\n1 WIFE @I2@\n0 @F2@ FAM\n1 HUSB @I1@\n1 WIFE @VOID@\n'
			)
		);
		expect(people).toHaveLength(2);
		expect(unionRows).toHaveLength(2);
		expect(out.match(/^1 (HUSB|WIFE) @VOID@$/gm)).toHaveLength(2);
	});

	it('keeps a pointer to a record Epoch does not model as a line, not a link', async () => {
		const { out, people } = await roundTrip(
			file(
				PEOPLE +
					'0 @F1@ FAM\n1 HUSB @I1@\n1 WIFE @O1@\n1 CHIL @U1@\n0 @O1@ OBJE\n1 FILE a.png\n2 FORM image/png\n0 @U1@ SUBM\n1 NAME Me\n'
			)
		);
		expect(people).toHaveLength(2);
		expect(out).toContain('1 WIFE @O1@');
		expect(out).toContain('1 CHIL @U1@');
	});

	it('imports a pointer to a record that is nowhere in the file, keeps it, and counts it', async () => {
		const text = file(PEOPLE + '0 @F1@ FAM\n1 HUSB @I1@\n1 CHIL @MISSING@\n');
		expect(parseGedcom(text).unresolved).toEqual({ void: 0, absent: 1 });
		const { out, people } = await roundTrip(text);
		expect(people).toHaveLength(2);
		expect(out).toContain('1 CHIL @VOID@');
	});

	it('counts @VOID@ apart from a record that is absent', () => {
		const parsed = parseGedcom(file(PEOPLE + '0 @F1@ FAM\n1 HUSB @VOID@\n1 WIFE @NOPE@\n'));
		expect(parsed.unresolved).toEqual({ void: 1, absent: 1 });
		expect(parsed.families[0].husbandId).toBeUndefined();
		expect(parsed.families[0].wifeId).toBeUndefined();
	});
});

describe('a person link to a family that is not in the file', () => {
	const text = file(
		'0 @I1@ INDI\n1 NAME A /B/\n1 FAMS @VOID@\n2 NOTE The second wife\n1 FAMC @VOID@\n2 PEDI ADOPTED\n1 FAMS @GONE@\n'
	);

	it('keeps FAMS @VOID@ with its note, and FAMC @VOID@ with its PEDI, as retained lines', async () => {
		const { treeId, out } = await roundTrip(text);
		expect(parseGedcom(text).unresolved).toEqual({ void: 2, absent: 1 });
		expect(out).toContain('1 FAMS @VOID@\n2 NOTE The second wife\n');
		expect(out).toContain('1 FAMS @VOID@');
		// A FAMC with no link to sit in is written under its person, with the PEDI beneath it.
		expect(out).toContain('1 FAMC @VOID@\n2 PEDI ADOPTED\n');
		const kept = ((await getTreeExportData(t.d1, treeId)).preserved ?? []).map((p) =>
			p.lines.join('\n')
		);
		expect(kept).toContain('1 FAMC @VOID@\n2 PEDI ADOPTED');
	});
});

describe('a family with no partner', () => {
	it('keeps its children as CHIL lines, since a child is held by a link to a parent', async () => {
		const { out, links } = await roundTrip(
			file('0 @I1@ INDI\n1 NAME A /B/\n1 FAMC @F1@\n0 @F1@ FAM\n1 HUSB @VOID@\n1 CHIL @I1@\n')
		);
		expect(links).toHaveLength(0);
		expect(out).toContain(
			'1 CHIL @I1@'.replace('I1', out.match(/^0 (@[^@]+@) INDI/m)![1].slice(1, -1))
		);
	});
});
