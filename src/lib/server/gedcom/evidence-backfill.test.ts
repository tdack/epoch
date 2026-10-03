/**
 * The backfill moves the evidence a tree kept as retained lines into records. The bar it is held to:
 * a tree imported the old way and then backfilled holds the same records, and writes the same file,
 * as the same file imported afresh; and running it again changes nothing.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import EVIDENCE from './fixtures/evidence.ged?raw';
import SOURCES7 from './fixtures/sources7.ged?raw';
import { citations, repositories, sourceRepositories, sources } from '../db/schema';
import { createTestDatabase, type TestDatabase } from '../testing/d1';
import {
	getTreeExportData,
	importGedcomAsRetainedLines,
	importGedcomToDb
} from '../testing/gedcom';
import {
	BACKFILL_QUERIES,
	evidenceBackfillStatements,
	type BackfillInput
} from './evidence-backfill';
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

async function runBackfill(): Promise<number> {
	const input = {} as Record<string, unknown[]>;
	for (const [name, sql] of Object.entries(BACKFILL_QUERIES))
		input[name] = (await t.d1.prepare(sql).all()).results;
	const statements = evidenceBackfillStatements(input as unknown as BackfillInput);
	for (const statement of statements) await t.d1.prepare(statement).run();
	return statements.length;
}

/** The records of a tree without the ids that differ between two trees. */
async function recordsOf(treeId: string) {
	const sourceRows = await t.db.select().from(sources).where(eq(sources.treeId, treeId)).all();
	const xrefOf = new Map(sourceRows.map((s) => [s.id, s.xref]));
	const repositoryRows = await t.db
		.select()
		.from(repositories)
		.where(eq(repositories.treeId, treeId))
		.all();
	const repositoryXref = new Map(repositoryRows.map((r) => [r.id, r.xref]));
	const links = (await t.db.select().from(sourceRepositories).all()).filter((l) =>
		xrefOf.has(l.sourceId)
	);
	const cited = await t.db.select().from(citations).where(eq(citations.treeId, treeId)).all();
	return {
		sources: sourceRows
			.map((s) => [s.xref, s.title, s.author, s.publication, s.text, s.gedcomExtra, s.gedcomLayout])
			.map((r) => JSON.stringify(r))
			.sort(),
		repositories: repositoryRows
			.map((r) => JSON.stringify([r.xref, r.name, r.address, r.gedcomExtra, r.gedcomLayout]))
			.sort(),
		links: links
			.map((l) =>
				JSON.stringify([
					xrefOf.get(l.sourceId),
					l.repositoryId ? repositoryXref.get(l.repositoryId) : l.repositoryRef,
					l.callNumber,
					l.gedcomExtra,
					l.sortOrder
				])
			)
			.sort(),
		citations: cited
			.map((c) =>
				JSON.stringify([
					c.subjectKind,
					c.sortOrder,
					c.sourceId ? xrefOf.get(c.sourceId) : c.sourceRef,
					c.description,
					c.page,
					c.quality,
					c.entryDateRaw,
					c.text,
					c.gedcomExtra,
					c.gedcomLayout
				])
			)
			.sort()
	};
}

describe.each([
	['the evidence fixture', EVIDENCE],
	['a GEDCOM 7 file with citations', SOURCES7]
])('backfilling %s', (_name, fixture) => {
	it('gives the same records and the same file as importing it afresh', async () => {
		const fresh = crypto.randomUUID();
		const old = crypto.randomUUID();
		await importGedcomToDb(t.d1, fresh, fixture, 'Fresh');
		await importGedcomAsRetainedLines(t.d1, old, fixture);

		// Imported the old way, nothing is a record yet.
		expect((await recordsOf(old)).citations).toEqual([]);
		expect((await recordsOf(old)).sources).toEqual([]);

		expect(await runBackfill()).toBeGreaterThan(0);

		expect(await recordsOf(old)).toEqual(await recordsOf(fresh));
		expect(await exportOf(old, '551')).toEqual(await exportOf(fresh, '551'));
		expect(await exportOf(old, '7')).toEqual(await exportOf(fresh, '7'));
	});

	it('changes nothing the second time', async () => {
		const treeId = crypto.randomUUID();
		await importGedcomAsRetainedLines(t.d1, treeId, fixture);
		await runBackfill();
		const records = await recordsOf(treeId);
		const file = await exportOf(treeId, '551');
		expect(await runBackfill()).toBe(0);
		expect(await recordsOf(treeId)).toEqual(records);
		expect(await exportOf(treeId, '551')).toEqual(file);
	});
});
