import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { events } from '../db/schema';
import { createTestDatabase, type TestDatabase } from '../testing/d1';
import { getTreeExportData, importGedcomToDb, previewGedcomImport } from '../testing/gedcom';

let t: TestDatabase;
beforeAll(async () => {
	t = await createTestDatabase();
});
afterAll(async () => {
	await t.dispose();
});

const head = `0 HEAD
1 GEDC
2 VERS 5.5.1
0 @I1@ INDI
1 NAME Wren /Ash/
1 SEX F
`;

/** Two births on one date that differ only by the address on the second. */
const ONE_BIRTH = `${head}1 BIRT
2 DATE 4 MAR 1900
2 ADDR 1 High Street
0 TRLR
`;
const TWO_BIRTHS = `${head}1 BIRT
2 DATE 4 MAR 1900
2 ADDR 1 High Street
1 BIRT
2 DATE 4 MAR 1900
2 ADDR 9 Low Road
0 TRLR
`;

const birthsOf = async (treeId: string) =>
	t.db
		.select()
		.from(events)
		.where(and(eq(events.treeId, treeId), eq(events.type, 'BIRT')))
		.all();

describe('import preview agrees with the import', () => {
	it('counts a fact that differs only by a kept line as new, and writes it', async () => {
		const treeId = crypto.randomUUID();
		await importGedcomToDb(t.d1, treeId, ONE_BIRTH, 'Births');
		expect(await birthsOf(treeId)).toHaveLength(1);

		// The same file again is a repeat, so the preview counts nothing new and the import adds nothing.
		expect((await previewGedcomImport(t.d1, treeId, ONE_BIRTH)).merge?.newEvents).toBe(0);
		await importGedcomToDb(t.d1, treeId, ONE_BIRTH, 'ignored', 'merge');
		expect(await birthsOf(treeId)).toHaveLength(1);

		const preview = await previewGedcomImport(t.d1, treeId, TWO_BIRTHS);
		expect(preview.merge?.newEvents).toBe(1);
		expect(preview.merge?.duplicateEvents).toBe(1);

		await importGedcomToDb(t.d1, treeId, TWO_BIRTHS, 'ignored', 'merge');
		expect(await birthsOf(treeId)).toHaveLength(2);
		expect((await getTreeExportData(t.d1, treeId)).individuals).toHaveLength(1);
	});
});
