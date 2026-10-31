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
