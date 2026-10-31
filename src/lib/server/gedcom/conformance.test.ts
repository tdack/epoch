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

const KNOWN_GAPS: Record<string, KnownGap> = {};

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
