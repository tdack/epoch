/**
 * The fact-detail backfill moves the detail structures a tree kept as retained lines into their
 * columns. The bar it is held to is the notes backfill's: a tree imported the old way and then
 * backfilled holds the same values, and writes the same lines, as the same file imported afresh;
 * a value already in a column is never replaced; and running it again changes nothing.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import DETAILS from '../../../../test/data/fact-details.ged?raw';
import WINDSORS from '../../../../test/data/The Windsors.ged?raw';
import { events } from '../db/schema';
import { createTestDatabase, type TestDatabase } from '../testing/d1';
import {
	getTreeExportData,
	importGedcomAsRetainedFactDetails,
	importGedcomToDb
} from '../testing/gedcom';
import {
	FACT_DETAIL_BACKFILL_QUERIES,
	factDetailBackfillStatements,
	type FactDetailBackfillInput
} from './fact-detail-backfill';
import { buildGedcom551String, buildGedcom7String } from './serializer';

let t: TestDatabase;
beforeAll(async () => {
	t = await createTestDatabase();
});
afterAll(async () => {
	await t.dispose();
});

const lines = (text: string) => text.replace(/\r\n/g, '\n').split('\n').filter(Boolean);
const withoutHeader = (all: string[]) =>
	all.slice(all.findIndex((line, i) => i > 0 && line.startsWith('0 ')));
const exportOf = async (treeId: string, format: '551' | '7') => {
	const data = await getTreeExportData(t.d1, treeId);
	return withoutHeader(
		lines(format === '551' ? buildGedcom551String(data) : buildGedcom7String(data))
	);
};

/** The lines an event's details are written as: the same in both trees, whatever order they fall in. */
const DETAIL_LINE =
	/^\d+ (ADDR|CONT|CONC|ADR1|CITY|STAE|POST|CTRY|PHON|EMAIL|FAX|WWW|TYPE|AGNC|RELI)( |$)/;
const detailLinesOf = (all: string[]) => all.filter((line) => DETAIL_LINE.test(line)).sort();

async function runBackfill(): Promise<number> {
	const input = {} as Record<string, unknown[]>;
	for (const [name, sql] of Object.entries(FACT_DETAIL_BACKFILL_QUERIES))
		input[name] = (await t.d1.prepare(sql).all()).results;
	const statements = factDetailBackfillStatements(input as unknown as FactDetailBackfillInput);
	for (const statement of statements) await t.d1.prepare(statement).run();
	return statements.length;
}

/**
 * The extra lines without any `PLAC` subtree. An import that predates the details dropped a `PLAC`'s
 * sub-lines (and a `PLAC` with no value kept whole here); the backfill cannot bring those back, so
 * they are not part of what it is compared on.
 */
function withoutPlaceLines(extra: string[] | null | undefined): string[] | null {
	const kept: string[] = [];
	let placeLevel: number | null = null;
	for (const line of extra ?? []) {
		const level = Number(/^\s*(\d+)/.exec(line)?.[1]);
		if (placeLevel !== null && level > placeLevel) continue;
		placeLevel = null;
		if (/^\d+ PLAC( |$)/.test(line)) {
			placeLevel = level;
			continue;
		}
		kept.push(line);
	}
	return kept.length > 0 ? kept : null;
}

/** A tree's events with the columns the backfill fills, keyed by what they are rather than by id. */
async function eventsOf(treeId: string) {
	const rows = await t.db.select().from(events).where(eq(events.treeId, treeId)).all();
	const strip = (id: string) => id.replace(`${treeId}:`, '');
	return rows
		.map((r) =>
			JSON.stringify([
				r.type,
				strip(r.entityId),
				r.dateRaw,
				r.place,
				r.address,
				r.addressLayout,
				r.classification,
				r.agency,
				r.phone,
				r.email,
				r.fax,
				r.web,
				r.religion,
				withoutPlaceLines(r.gedcomExtra)
			])
		)
		.sort();
}

describe.each([
	['the fact-details fixture', DETAILS],
	['The Windsors', WINDSORS]
])('backfilling the details of %s', (_name, fixture) => {
	it('gives the same values and the same lines as importing it afresh', async () => {
		const fresh = crypto.randomUUID();
		const old = crypto.randomUUID();
		await importGedcomToDb(t.d1, fresh, fixture, 'Fresh');
		await importGedcomAsRetainedFactDetails(t.d1, old, fixture);

		// Imported the old way, no detail is in a column yet.
		const before = await t.db.select().from(events).where(eq(events.treeId, old)).all();
		expect(before.filter((r) => r.address !== null || r.phone !== null)).toEqual([]);

		expect(await runBackfill()).toBeGreaterThan(0);

		expect(await eventsOf(old)).toEqual(await eventsOf(fresh));
		expect(detailLinesOf(await exportOf(old, '551'))).toEqual(
			detailLinesOf(await exportOf(fresh, '551'))
		);
		expect(detailLinesOf(await exportOf(old, '7'))).toEqual(
			detailLinesOf(await exportOf(fresh, '7'))
		);
	});

	it('changes nothing the second time', async () => {
		const treeId = crypto.randomUUID();
		await importGedcomAsRetainedFactDetails(t.d1, treeId, fixture);
		await runBackfill();
		const rows = await eventsOf(treeId);
		const file = await exportOf(treeId, '551');
		expect(await runBackfill()).toBe(0);
		expect(await eventsOf(treeId)).toEqual(rows);
		expect(await exportOf(treeId, '551')).toEqual(file);
	});
});

describe('the Windsors file', () => {
	it('moves every modelled address out of the extra lines and into its column', async () => {
		const treeId = crypto.randomUUID();
		await importGedcomAsRetainedFactDetails(t.d1, treeId, WINDSORS);
		await runBackfill();
		const rows = await t.db.select().from(events).where(eq(events.treeId, treeId)).all();
		expect(rows.filter((r) => r.address !== null)).toHaveLength(61);
		expect(rows.filter((r) => r.gedcomExtra?.some((l) => /^\d+ ADDR( |$)/.test(l)))).toEqual([]);
	});
});

describe('what the backfill leaves alone', () => {
	const file = [
		'0 HEAD',
		'1 GEDC',
		'2 VERS 5.5.1',
		'0 @I1@ INDI',
		'1 NAME Ann /Ash/',
		'1 BIRT',
		'2 DATE 1900',
		'2 PLAC York',
		'2 ADDR 1 High St',
		'3 CITY York',
		'2 AGNC Parish',
		'2 TYPE Baptism',
		'2 TYPE Second',
		'2 ADDR 2 Second St',
		'2 _CUSTOM kept',
		'2 OBJE @M1@',
		'1 DEAT',
		'2 DATE 1950',
		'0 TRLR',
		''
	].join('\n');

	it('never replaces a value already in its column; the line stays in the extra lines', async () => {
		const treeId = crypto.randomUUID();
		await importGedcomAsRetainedFactDetails(t.d1, treeId, file);
		// An edit made before the backfill: the agency is the user's, not the file's.
		await t.db
			.update(events)
			.set({ agency: 'Edited agency' })
			.where(eq(events.treeId, treeId))
			.run();
		const [birthBefore] = (
			await t.db.select().from(events).where(eq(events.treeId, treeId)).all()
		).filter((r) => r.type === 'BIRT');
		const versionBefore = birthBefore!.version;

		await runBackfill();

		const [birth] = (
			await t.db.select().from(events).where(eq(events.treeId, treeId)).all()
		).filter((r) => r.type === 'BIRT');
		expect(birth!.agency).toBe('Edited agency');
		expect(birth!.gedcomExtra).toEqual(
			expect.arrayContaining(['2 AGNC Parish', '2 TYPE Second', '2 ADDR 2 Second St'])
		);
		// The first ADDR and TYPE moved, once, and the version is bumped exactly once.
		expect(birth!.address).toBe('1 High St');
		expect(birth!.classification).toBe('Baptism');
		expect(birth!.version).toBe(versionBefore + 1);
	});

	it('keeps unrelated extra lines, and a second TYPE or ADDR, in the extra lines', async () => {
		const treeId = crypto.randomUUID();
		await importGedcomAsRetainedFactDetails(t.d1, treeId, file);
		await runBackfill();
		const [birth] = (
			await t.db.select().from(events).where(eq(events.treeId, treeId)).all()
		).filter((r) => r.type === 'BIRT');
		expect(birth!.gedcomExtra).toEqual(
			expect.arrayContaining([
				'2 TYPE Second',
				'2 ADDR 2 Second St',
				'2 _CUSTOM kept',
				'2 OBJE @M1@'
			])
		);
		expect(birth!.gedcomExtra).not.toContain('2 TYPE Baptism');
		expect(birth!.gedcomExtra).not.toContain('2 ADDR 1 High St');
		expect(birth!.gedcomExtra).not.toContain('3 CITY York');
	});
});
