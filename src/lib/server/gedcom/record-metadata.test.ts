/**
 * Identifiers (`EXID`, `UID`, `REFN`) and record metadata (`CHAN`, `CREA`) on every record kind,
 * imported and exported again. Identifiers have no column: they come back as retained lines, which
 * is enough, so what is checked here is that none is dropped or moved to another record.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../testing/d1';
import { getTreeExportData, importGedcomToDb } from '../testing/gedcom';
import { semanticDiff } from './semantic-diff';
import { buildGedcom551String, buildGedcom7String } from './serializer';
import { validateGedcom7 } from './validate7';

let t: TestDatabase;
beforeAll(async () => {
	t = await createTestDatabase();
});
afterAll(async () => {
	await t.dispose();
});

const HEAD = ['0 HEAD', '1 GEDC', '2 VERS 7.0'];
const file = (...records: string[]) => [...HEAD, ...records, '0 TRLR'].join('\n');

async function trip(original: string) {
	const treeId = crypto.randomUUID();
	await importGedcomToDb(t.d1, treeId, original, 'Snippet');
	const data = await getTreeExportData(t.d1, treeId);
	const exported = buildGedcom7String(data);
	const diff = semanticDiff(original, exported);
	return {
		data,
		exported,
		exported551: buildGedcom551String(data),
		errors: validateGedcom7(exported).errors.map((e) => `${e.code} ${e.path}`),
		diffs: [
			...diff.recordsMissing.map((r) => `record-missing ${r}`),
			...diff.recordsAdded.map((r) => `record-added ${r}`),
			...diff.changes.map((c) => `${c.kind} ${c.path}: ${c.before ?? ''} => ${c.after ?? ''}`)
		]
	};
}

const IDS = [
	'1 UID 11111111-2222-4333-8444-555555555555',
	'1 EXID 12345',
	'2 TYPE https://example.com/ids',
	'1 EXID 67890',
	'2 TYPE https://example.org/other',
	'1 REFN ref-1',
	'2 TYPE mine',
	'1 REFN ref-2'
];

const KINDS: Record<string, string[]> = {
	INDI: ['0 @I1@ INDI', '1 NAME Ann /Ash/'],
	FAM: ['0 @I1@ INDI', '1 NAME Ann /Ash/', '1 FAMS @F1@', '0 @F1@ FAM', '1 WIFE @I1@'],
	SOUR: ['0 @S1@ SOUR', '1 TITL Parish register'],
	REPO: ['0 @R1@ REPO', '1 NAME County archive'],
	SNOTE: ['0 @N1@ SNOTE A shared note'],
	OBJE: ['0 @O1@ OBJE', '1 FILE photo.txt', '2 FORM text/plain'],
	SUBM: ['0 @U1@ SUBM', '1 NAME Sam Submitter']
};

/** Puts `IDS` on the record the first line of `lines` heads (`FAM` is the last one in its list). */
function withIdentifiers(kind: string, lines: string[]): string[] {
	const headIndex = kind === 'FAM' ? lines.findIndex((l) => l.endsWith(' FAM')) : 0;
	const rest = lines.slice(headIndex + 1);
	return [...lines.slice(0, headIndex + 1), ...IDS, ...rest];
}

describe('identifiers on every record kind', () => {
	it.each(Object.keys(KINDS))('keeps UID, EXID and REFN on a %s', async (kind) => {
		const { exported, errors, diffs } = await trip(file(...withIdentifiers(kind, KINDS[kind])));
		expect(diffs).toEqual([]);
		expect(errors).toEqual([]);
		for (const line of IDS) expect(exported).toContain(`${line}\r\n`);
	});
});

describe('CHAN and CREA', () => {
	const STAMPED = [
		'0 @I1@ INDI',
		'1 NAME Ann /Ash/',
		'1 FAMS @F1@',
		'1 CHAN',
		'2 DATE 1 JAN 2000',
		'3 TIME 01:02:03Z',
		'1 CREA',
		'2 DATE 2 JAN 1999',
		'0 @F1@ FAM',
		'1 WIFE @I1@',
		'1 CHAN',
		'2 DATE 1 JAN 2000',
		'0 @S1@ SOUR',
		'1 TITL Register',
		'1 CHAN',
		'2 DATE 1 JAN 2000',
		'0 @R1@ REPO',
		'1 NAME Archive',
		'1 CHAN',
		'2 DATE 1 JAN 2000',
		'0 @N1@ SNOTE A shared note',
		'1 CHAN',
		'2 DATE 1 JAN 2000'
	];
	const AT = new Date(Date.UTC(2024, 2, 5, 6, 7, 8));
	const count = (text: string, line: string) => text.split(`${line}\r\n`).length - 1;

	/** Stamps every record the way a row of Epoch's own would be. */
	function stamped(data: Awaited<ReturnType<typeof trip>>['data'], at: Date | null) {
		for (const list of [
			data.individuals,
			data.families,
			data.sources ?? [],
			data.repositories ?? [],
			data.notes ?? []
		])
			for (const record of list) Object.assign(record, { changedAt: at, createdAt: at });
		return data;
	}

	it("writes Epoch's timestamps in place of the file's, once per record, in 7.0", async () => {
		const { data } = await trip(file(...STAMPED));
		const text = buildGedcom7String(stamped(data, AT));
		expect(count(text, '1 CHAN')).toBe(5);
		expect(count(text, '1 CREA')).toBe(5);
		expect(count(text, '2 DATE 5 MAR 2024')).toBe(10);
		expect(count(text, '3 TIME 06:07:08Z')).toBe(10);
		expect(text).not.toContain('1 JAN 2000');
		expect(text).not.toContain('2 JAN 1999');
		expect(validateGedcom7(text).errors).toEqual([]);
	});

	it('writes CHAN but not CREA in 5.5.1, with a time that has no Z', async () => {
		const { data } = await trip(file(...STAMPED));
		const text = buildGedcom551String(stamped(data, AT));
		expect(count(text, '1 CHAN')).toBe(5);
		expect(text).not.toContain('CREA');
		expect(count(text, '3 TIME 06:07:08')).toBe(5);
		expect(text).not.toContain('1 JAN 2000');
	});

	it("keeps the file's own CHAN and CREA when Epoch has no timestamp for the record", async () => {
		const { data } = await trip(file(...STAMPED));
		const text = buildGedcom7String(stamped(data, null));
		expect(count(text, '1 CHAN')).toBe(5);
		expect(count(text, '2 DATE 1 JAN 2000')).toBe(5);
		expect(count(text, '1 CREA')).toBe(1);
	});

	it('does not count either as a difference when the file is compared', async () => {
		const { diffs } = await trip(file(...STAMPED));
		expect(diffs).toEqual([]);
	});
});
