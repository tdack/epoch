/**
 * Small inline 7.0 snippets, one structure each, imported and exported again. Every one must come
 * back with an empty semantic diff and no validator error, so a structure that is dropped or
 * reshaped fails here by name rather than somewhere in a large official file.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../testing/d1';
import { getTreeExportData, importGedcomToDb } from '../testing/gedcom';
import { semanticDiff } from './semantic-diff';
import { buildGedcom7String } from './serializer';
import { validateGedcom7 } from './validate7';

let t: TestDatabase;
beforeAll(async () => {
	t = await createTestDatabase();
});
afterAll(async () => {
	await t.dispose();
});

const HEAD = ['0 HEAD', '1 GEDC', '2 VERS 7.0'];

/** A 7.0 file with the given records after a minimal header. */
const file = (...records: string[]) => [...HEAD, ...records, '0 TRLR'].join('\n');

async function trip(original: string) {
	const treeId = crypto.randomUUID();
	await importGedcomToDb(t.d1, treeId, original, 'Snippet');
	const exported = buildGedcom7String(await getTreeExportData(t.d1, treeId));
	const diff = semanticDiff(original, exported);
	return {
		exported,
		errors: validateGedcom7(exported).errors.map((e) => `${e.code} ${e.path}`),
		diffs: [
			...diff.recordsMissing.map((r) => `record-missing ${r}`),
			...diff.recordsAdded.map((r) => `record-added ${r}`),
			...diff.changes.map((c) => `${c.kind} ${c.path}: ${c.before ?? ''} => ${c.after ?? ''}`)
		]
	};
}

async function expectClean(original: string) {
	const result = await trip(original);
	expect(result.errors).toEqual([]);
	expect(result.diffs).toEqual([]);
	return result.exported;
}

const FAMILY = [
	'0 @I1@ INDI',
	'1 NAME Ann /Ash/',
	'1 SEX F',
	'1 FAMS @F1@',
	'0 @I2@ INDI',
	'1 NAME Bob /Ash/',
	'1 SEX M',
	'1 FAMS @F1@'
];

describe('an event payload', () => {
	it('keeps Y on a family event, and the date beneath it', async () => {
		const text = await expectClean(
			file(...FAMILY, '0 @F1@ FAM', '1 HUSB @I2@', '1 WIFE @I1@', '1 MARR Y', '2 DATE 1 JAN 1900')
		);
		expect(text).toMatch(/1 MARR Y\r\n/);
		expect(text).not.toContain('NOTE Y');
	});

	it('keeps Y on an individual event', async () => {
		const text = await expectClean(
			file('0 @I1@ INDI', '1 NAME Ann /Ash/', '1 SEX F', '1 BIRT Y', '1 DEAT Y', '2 DATE 1900')
		);
		expect(text).toMatch(/1 BIRT Y\r\n/);
	});
});

describe('an AGE with only a PHRASE', () => {
	it('is kept', async () => {
		const text = await expectClean(
			file(
				'0 @I1@ INDI',
				'1 CHR',
				'2 AGE',
				'3 PHRASE Zero',
				'1 BAPM',
				'2 AGE < 3m',
				'3 PHRASE Small'
			)
		);
		expect(text).toMatch(/2 AGE\r\n3 PHRASE Zero/);
	});
});

describe('a PHRASE under HUSB, WIFE and CHIL', () => {
	it('stays under the same link', async () => {
		const text = await expectClean(
			file(
				...FAMILY,
				'0 @I3@ INDI',
				'1 NAME Cy /Ash/',
				'1 SEX M',
				'1 FAMC @F1@',
				'0 @F1@ FAM',
				'1 HUSB @I2@',
				'2 PHRASE the husband',
				'1 WIFE @I1@',
				'2 PHRASE the wife',
				'1 CHIL @I3@',
				'2 PHRASE the child'
			)
		);
		expect(text).toMatch(/1 CHIL @\w+@\r\n2 PHRASE the child/);
	});

	it('keeps a PHRASE on a child of a family with no partner', async () => {
		await expectClean(
			file('0 @I3@ INDI', '1 NAME Cy /Ash/', '1 SEX M', '0 @F1@ FAM', '1 CHIL @I3@', '2 PHRASE kid')
		);
	});
});

describe('LDS ordinances', () => {
	const ordinance = (tag: string) => [
		`1 ${tag}`,
		'2 DATE 27 MAR 2022',
		'2 TEMP SLAKE',
		'2 PLAC Salt Lake City',
		'2 STAT COMPLETED',
		'3 DATE 28 MAR 2022',
		'4 TIME 10:00:00',
		'2 NOTE An ordinance',
		'2 SOUR @S1@'
	];

	it('keeps every individual ordinance, with its TEMP, STAT, PLAC and DATE', async () => {
		const text = await expectClean(
			file(
				'0 @I1@ INDI',
				'1 NAME Ann /Ash/',
				'1 SEX F',
				...['BAPL', 'CONL', 'ENDL', 'INIL'].flatMap(ordinance),
				'1 SLGC',
				'2 TEMP SLAKE',
				'2 FAMC @F1@',
				'1 FAMC @F1@',
				'0 @I2@ INDI',
				'1 SEX M',
				'1 FAMS @F1@',
				'0 @F1@ FAM',
				'1 HUSB @I2@',
				'1 CHIL @I1@',
				'0 @S1@ SOUR',
				'1 TITL A source'
			)
		);
		expect(text.match(/^1 (BAPL|CONL|ENDL|INIL)$/gm)).toHaveLength(4);
	});

	it('keeps a family sealing, and repeats of it', async () => {
		const text = await expectClean(
			file(
				...FAMILY,
				'0 @F1@ FAM',
				'1 HUSB @I2@',
				'1 WIFE @I1@',
				...ordinance('SLGS'),
				'1 SLGS',
				'2 DATE 27 MAR 2022',
				'1 SLGS',
				'2 DATE 27 MAR 2022',
				'0 @S1@ SOUR',
				'1 TITL A source'
			)
		);
		expect(text.match(/^1 SLGS$/gm)).toHaveLength(3);
	});

	it('does not double the repeats when the same file is merged in again', async () => {
		const original = file(
			...FAMILY,
			'0 @F1@ FAM',
			'1 HUSB @I2@',
			'1 WIFE @I1@',
			'1 SLGS',
			'2 DATE 27 MAR 2022',
			'1 SLGS',
			'2 DATE 27 MAR 2022'
		);
		const treeId = crypto.randomUUID();
		await importGedcomToDb(t.d1, treeId, original, 'Merge');
		await importGedcomToDb(t.d1, treeId, original, 'Merge', 'merge');
		const text = buildGedcom7String(await getTreeExportData(t.d1, treeId));
		expect(text.match(/^1 SLGS$/gm)).toHaveLength(2);
	});
});

describe('a person record the file gave no XREF', () => {
	it('keeps its ASSO with an extension ROLE, its SUBM pointer and an extension pointer structure', async () => {
		const text = await expectClean(
			[
				'0 HEAD',
				'1 GEDC',
				'2 VERS 7.0',
				'1 SCHMA',
				'2 TAG _PARTY http://example.com/party-participation',
				'2 TAG _ROLE http://example.com/role',
				'0 @U1@ SUBM',
				'1 NAME Someone',
				'0 @I1@ INDI',
				'1 NAME Ann /Ash/',
				'1 SEX F',
				'0 INDI',
				'1 NAME Bob /Ash/',
				'1 SEX M',
				'1 SUBM @U1@',
				'1 ASSO @I1@',
				'2 ROLE _ROLE',
				'1 _PARTY @P1@',
				'2 ROLE NGHBR',
				'0 @P1@ _PARTY',
				'1 NAME A party',
				'0 TRLR'
			].join('\n')
		);
		expect(text).toMatch(/1 ASSO @\w+@\r\n2 ROLE _ROLE/);
	});
});

describe('fact structures', () => {
	const SOURCE = ['0 @S1@ SOUR', '1 TITL A source'];

	it('keeps NO, with its DATE, NOTE and SOUR', async () => {
		const text = await expectClean(
			file(
				'0 @I1@ INDI',
				'1 NAME Ann /Ash/',
				'1 SEX F',
				'1 NO MARR',
				'2 DATE FROM 1900 TO 1910',
				'2 NOTE She never married.',
				'2 SOUR @S1@',
				'3 PAGE 4',
				'1 NO DIV',
				...SOURCE
			)
		);
		expect(text.match(/^1 NO (MARR|DIV)\r$/gm)).toHaveLength(2);
	});

	it('keeps SDATE under an event, with its PHRASE', async () => {
		const text = await expectClean(
			file(
				'0 @I1@ INDI',
				'1 NAME Ann /Ash/',
				'1 SEX F',
				'1 BIRT',
				'2 DATE ABT 1900',
				'2 SDATE 1900',
				'3 PHRASE sorted as a year'
			)
		);
		expect(text).toMatch(/2 SDATE 1900\r\n3 PHRASE sorted as a year/);
	});

	it('keeps a TIME under the DATE of an ordinance status', async () => {
		const text = await expectClean(
			file(
				'0 @I1@ INDI',
				'1 NAME Ann /Ash/',
				'1 SEX F',
				'1 BAPL',
				'2 STAT COMPLETED',
				'3 DATE 27 MAR 2022',
				'4 TIME 01:02:03Z'
			)
		);
		expect(text).toMatch(/3 DATE 27 MAR 2022\r\n4 TIME 01:02:03Z/);
	});

	it.each(['> 10y 3m', '< 3m', '10y 3m 2w 1d', '0y', '42d'])('keeps the age %s', async (age) => {
		const text = await expectClean(
			file('0 @I1@ INDI', '1 NAME Ann /Ash/', '1 SEX F', '1 DEAT', `2 AGE ${age}`)
		);
		expect(text).toContain(`2 AGE ${age}`);
	});

	it('keeps an age under HUSB and WIFE of a family event', async () => {
		await expectClean(
			file(
				...FAMILY,
				'0 @F1@ FAM',
				'1 HUSB @I2@',
				'1 WIFE @I1@',
				'1 MARR',
				'2 HUSB',
				'3 AGE 20y',
				'2 WIFE',
				'3 AGE > 18y',
				'4 PHRASE a legal adult'
			)
		);
	});

	it('keeps ALIA, with its PHRASE', async () => {
		const text = await expectClean(
			file(
				'0 @I1@ INDI',
				'1 NAME Ann /Ash/',
				'1 SEX F',
				'1 ALIA @I2@',
				'2 PHRASE the same woman',
				'0 @I2@ INDI',
				'1 NAME Anne /Ash/',
				'1 SEX F'
			)
		);
		expect(text).toMatch(/1 ALIA @\w+@\r\n2 PHRASE the same woman/);
	});

	it('keeps STAT and its PHRASE under FAMC', async () => {
		const text = await expectClean(
			file(
				'0 @I3@ INDI',
				'1 NAME Cy /Ash/',
				'1 SEX M',
				'1 FAMC @F1@',
				'2 PEDI ADOPTED',
				'2 STAT CHALLENGED',
				'3 PHRASE disputed',
				'0 @I2@ INDI',
				'1 NAME Bob /Ash/',
				'1 SEX M',
				'1 FAMS @F1@',
				'0 @F1@ FAM',
				'1 HUSB @I2@',
				'1 CHIL @I3@'
			)
		);
		expect(text).toMatch(/2 STAT CHALLENGED\r\n3 PHRASE disputed/);
	});
});
