import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../testing/d1';
import { getTreeExportData, importGedcomToDb } from '../testing/gedcom';
import { parseGedcom } from './parser';
import { buildGedcom551String, buildGedcom7String } from './serializer';

const KEPT = [
	'2 DATE 1 JAN 1900',
	'3 TIME 10:30',
	'2 CAUS Fever',
	'3 CONT in the lungs',
	'2 AGE 42y',
	'3 PHRASE forty-two'
];
const file = (version: string) =>
	[
		'0 HEAD',
		'1 GEDC',
		`2 VERS ${version}`,
		'0 @I1@ INDI',
		'1 NAME A /B/',
		'1 DEAT',
		...KEPT,
		'0 @F1@ FAM',
		'1 MARR',
		'2 DATE 2 FEB 1920',
		'3 TIME 09:00',
		'0 TRLR'
	].join('\n');

let t: TestDatabase;
beforeAll(async () => {
	t = await createTestDatabase();
});
afterAll(async () => {
	await t.dispose();
});

describe('DATE, CAUS and AGE sub-lines', () => {
	it('are read verbatim, and not read when fact details are not modelled', () => {
		const parsed = parseGedcom(file('5.5.1'));
		const death = parsed.individuals[0]!.events[0]!;
		expect(death.dateExtra).toEqual(['3 TIME 10:30']);
		expect(death.causeExtra).toEqual(['3 CONT in the lungs']);
		expect(death.ageExtra).toEqual(['3 PHRASE forty-two']);
		expect(death.extra).toBeUndefined();
		expect(parsed.families[0]!.events[0]!.dateExtra).toEqual(['3 TIME 09:00']);
		const old = parseGedcom(file('5.5.1'), { areFactDetailsModelled: false });
		expect(old.individuals[0]!.events[0]!.dateExtra).toBeUndefined();
	});

	it('do not repeat a 7.0 date PHRASE already folded into the date text', () => {
		const text = file('7.0').replace('3 TIME 10:30', '3 TIME 10:30\n3 PHRASE sometime');
		expect(parseGedcom(text).individuals[0]!.events[0]!.dateExtra).toEqual(['3 TIME 10:30']);
	});

	it.each([
		['5.5.1', buildGedcom551String],
		['7.0', buildGedcom7String]
	])('survive an import and a %s export, each under its own line', async (version, build) => {
		const treeId = crypto.randomUUID();
		await importGedcomToDb(t.d1, treeId, file(version), 'Extras');
		const out = build(await getTreeExportData(t.d1, treeId)).split('\r\n');
		const at = out.indexOf('1 DEAT');
		expect(out.slice(at + 1, at + 1 + KEPT.length)).toEqual(KEPT);
		const marr = out.indexOf('1 MARR');
		expect(out.slice(marr + 1, marr + 3)).toEqual(['2 DATE 2 FEB 1920', '3 TIME 09:00']);
	});
});
