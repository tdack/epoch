/**
 * Round trip of the official GEDCOM 7.0 example files: import into a tree, export as 7.0, then
 * validate the export and diff it against the original by meaning.
 *
 * `KNOWN_GAPS` is the list of what does not hold yet. Each entry is exact in both directions: a
 * problem the entry does not name fails the suite, and so does an entry that names a problem which
 * has gone, so a fix that lands turns its entry red until the entry is deleted. The `task` is the
 * `docs/gedcom7-gdz-plan.md` task that closes the gap.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../testing/d1';
import { getTreeExportData, importGedcomToDb } from '../testing/gedcom';
import { semanticDiff, type GedcomDiff } from './semantic-diff';
import { buildGedcom7String } from './serializer';
import { validateGedcom7 } from './validate7';

interface KnownGap {
	reason: string;
	/** The plan task that fixes it, such as `1A.6`. */
	task: string;
	/** The import throws. The entry stays only while it still does. */
	isImportFailure?: boolean;
	/** Validator errors left in the export, as `code path`. */
	errors?: string[];
	/** Differences from the original, as `kind path` or `record-missing TAG` / `record-added TAG`. */
	diffs?: string[];
}

const IMPORT_FAILS_FK = 'import fails (FK)';

const INVENTS_NAME_SEX = 'export invents NAME // and SEX U for a person the file leaves without';
const IMPORT_FAILS_D1 = 'import fails (D1 write: fetch failed)';
const FIXTURE_LEGACY_LINES = 'kept 5.5.1 lines written as they came';

const KNOWN_GAPS: Record<string, KnownGap> = {
	'age.ged': {
		reason: `AGE with only a PHRASE is dropped; ${INVENTS_NAME_SEX}`,
		task: '1A.5',
		diffs: ['added INDI.NAME', 'added INDI.SEX', 'missing INDI.CHR.AGE']
	},
	'date.ged': { reason: IMPORT_FAILS_D1, task: '1A.0', isImportFailure: true },
	'escapes.ged': { reason: INVENTS_NAME_SEX, task: '1A.5', diffs: ['added INDI.SEX'] },
	'extension-record.ged': { reason: INVENTS_NAME_SEX, task: '1A.5', diffs: ['added INDI.SEX'] },
	'extensions.ged': {
		reason:
			'SCHMA dropped; FAMC @VOID@ dropped; ASSO, SUBM and _PARTY dropped from a person; ' +
			'extension-calendar dates become an empty DATE + PHRASE; a record with no xref gets a UUID; ' +
			INVENTS_NAME_SEX,
		task: '1A.1, 1A.5, 1A.6',
		errors: ['xref-format INDI'],
		diffs: [
			'added INDI.BIRT.DATE.PHRASE',
			'added INDI.DEAT.DATE.PHRASE',
			'added INDI.GRAD.DATE.PHRASE',
			'added INDI.NAME',
			'added INDI.SEX',
			'changed INDI.BIRT.DATE',
			'changed INDI.DEAT.DATE',
			'changed INDI.GRAD.DATE',
			'missing HEAD.SCHMA',
			'missing INDI.ASSO',
			'missing INDI.FAMC',
			'missing INDI.SUBM',
			'missing INDI._PARTY'
		]
	},
	'lang.ged': {
		reason: 'HEAD.LANG and HEAD.SCHMA dropped',
		task: '1A.1, 1A.3',
		diffs: ['missing HEAD.LANG', 'missing HEAD.SCHMA']
	},
	'maximal70-lds.ged': { reason: IMPORT_FAILS_FK, task: '1A.0', isImportFailure: true },
	'maximal70-memories1.ged': { reason: IMPORT_FAILS_FK, task: '1A.0', isImportFailure: true },
	'maximal70-memories2.ged': { reason: IMPORT_FAILS_FK, task: '1A.0', isImportFailure: true },
	'maximal70-tree1.ged': { reason: IMPORT_FAILS_FK, task: '1A.0', isImportFailure: true },
	'maximal70-tree2.ged': { reason: IMPORT_FAILS_FK, task: '1A.0', isImportFailure: true },
	'maximal70.ged': { reason: IMPORT_FAILS_FK, task: '1A.0', isImportFailure: true },
	'obje-1.ged': {
		reason: INVENTS_NAME_SEX,
		task: '1A.5',
		diffs: ['added INDI.NAME', 'added INDI.SEX']
	},
	'remarriage1.ged': { reason: INVENTS_NAME_SEX, task: '1A.5', diffs: ['added INDI.SEX'] },
	'remarriage2.ged': { reason: INVENTS_NAME_SEX, task: '1A.5', diffs: ['added INDI.SEX'] },
	'voidptr.ged': { reason: IMPORT_FAILS_FK, task: '1A.0', isImportFailure: true },
	'warnings70.ged': {
		reason: INVENTS_NAME_SEX,
		task: '1A.5',
		diffs: ['added INDI.NAME', 'added INDI.SEX']
	},
	'xref.ged': {
		reason: `a record with no xref gets a UUID; ${INVENTS_NAME_SEX}`,
		task: '1A.5, 1A.6',
		errors: ['xref-format INDI'],
		diffs: ['added INDI.NAME', 'added INDI.SEX']
	},
	// Epoch's own fixtures: validated only, since they are 5.5.1-era text.
	'evidence.ged': {
		reason: `${FIXTURE_LEGACY_LINES}: shared NOTE, inline SOUR, FAMC.SOUR, MISSING pointer, OBJE with no FILE`,
		task: '1A.1, 1A.6',
		errors: [
			'cardinality-min OBJE.FILE',
			'payload-unexpected INDI.BIRT.NOTE',
			'payload-unexpected INDI.NOTE',
			'payload-unexpected SOUR.NOTE',
			'pointer-format INDI.SOUR',
			'pointer-unresolved INDI.DEAT.SOUR',
			'root-tag-unknown NOTE',
			'tag-not-allowed INDI.FAMC.SOUR'
		]
	},
	'sources7.ged': {
		reason: 'SOUR under INDI.FAMC is written as it came',
		task: '1A.1',
		errors: ['tag-not-allowed INDI.FAMC.SOUR']
	}
};

// The files are fetched by `npm run gedcom:conformance` and gitignored, so a fresh clone has none
// and the suite skips, as validate7.test.ts does.
const conformance = import.meta.glob<string>('./fixtures/conformance/files/*.ged', {
	query: '?raw',
	import: 'default',
	eager: true
});
const own = import.meta.glob<string>('./fixtures/*.ged', {
	query: '?raw',
	import: 'default',
	eager: true
});

const baseName = (path: string) => path.slice(path.lastIndexOf('/') + 1);

let t: TestDatabase;
beforeAll(async () => {
	t = await createTestDatabase();
});
afterAll(async () => {
	await t.dispose();
});

interface Trip {
	importError?: string;
	errors: string[];
	diff?: GedcomDiff;
	diffs: string[];
}

async function roundTrip(original: string, isDiffed: boolean): Promise<Trip> {
	let exported: string;
	try {
		const treeId = crypto.randomUUID();
		await importGedcomToDb(t.d1, treeId, original, 'Round trip');
		exported = buildGedcom7String(await getTreeExportData(t.d1, treeId));
	} catch (error) {
		return { importError: String(error).slice(0, 120), errors: [], diffs: [] };
	}
	const errors = validateGedcom7(exported).errors.map((e) => `${e.code} ${e.path}`);
	if (!isDiffed) return { errors: unique(errors), diffs: [] };
	const diff = semanticDiff(original, exported);
	const diffs = [
		...diff.recordsMissing.map((r) => `record-missing ${r.split(' ')[0]}`),
		...diff.recordsAdded.map((r) => `record-added ${r.split(' ')[0]}`),
		...diff.changes.map((c) => `${c.kind} ${c.path}`)
	];
	return { errors: unique(errors), diff, diffs: unique(diffs) };
}

const unique = (items: string[]) => [...new Set(items)].sort();

function describeDiff(trip: Trip): string {
	if (!trip.diff) return '';
	const lines = [
		...trip.diff.recordsMissing.map((r) => `- record ${r}`),
		...trip.diff.recordsAdded.map((r) => `+ record ${r}`),
		...trip.diff.changes.map((c) => `${c.kind} ${c.path}: ${c.before ?? ''} => ${c.after ?? ''}`)
	];
	return lines.slice(0, 12).join('\n');
}

function check(name: string, trip: Trip, isDiffed: boolean) {
	const gap = KNOWN_GAPS[name];
	if (gap?.isImportFailure) {
		expect(trip.importError, `${name} imports now; delete its KNOWN_GAPS entry`).toBeDefined();
		return;
	}
	expect(trip.importError, 'import').toBeUndefined();
	expect(trip.errors, `validator errors in the export of ${name}`).toEqual(
		unique(gap?.errors ?? [])
	);
	if (isDiffed) {
		expect(trip.diffs, `differences from ${name}\n${describeDiff(trip)}`).toEqual(
			unique(gap?.diffs ?? [])
		);
	}
}

describe.skipIf(Object.keys(conformance).length === 0)(
	'the official GEDCOM 7.0 files round-trip',
	() => {
		it.each(Object.keys(conformance).map(baseName))('%s', async (name) => {
			const key = Object.keys(conformance).find((p) => baseName(p) === name)!;
			check(name, await roundTrip(conformance[key], true), true);
		});
	}
);

describe("Epoch's own fixtures export as valid 7.0", () => {
	it.each(Object.keys(own).map(baseName))('%s', async (name) => {
		const key = Object.keys(own).find((p) => baseName(p) === name)!;
		check(name, await roundTrip(own[key], false), false);
	});
});

describe('KNOWN_GAPS', () => {
	it('names a task for every entry', () => {
		for (const [name, gap] of Object.entries(KNOWN_GAPS)) {
			expect(gap.task, name).toMatch(/^\d[A-Z]?\.\d+(, \d[A-Z]?\.\d+)*$/);
			expect(gap.reason, name).not.toBe('');
		}
	});
});
