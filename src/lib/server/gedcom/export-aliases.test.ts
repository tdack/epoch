/**
 * What a merged-away person leaves behind in the file (ADR-022): their XREF is an alias of the
 * person who absorbed them, so structures kept under it, and pointers to it from anywhere in kept
 * lines, are written against the survivor and never against a record that no longer exists.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { individuals } from '../db/schema';
import { createTestDatabase, type TestDatabase } from '../testing/d1';
import { buildGedcom551String } from './index';
import { getTreeExportData, importGedcomToDb } from './importer';

const FILE = `0 HEAD
0 @I1@ INDI
1 NAME Keep /Er/
1 _CUSTOM kept on one
0 @I2@ INDI
1 NAME Gone /Er/
1 _CUSTOM kept on two
1 ASSO @I1@
2 RELA friend
0 @I3@ INDI
1 NAME Third /Er/
1 ASSO @I2@
2 RELA neighbour
0 TRLR`;

let t: TestDatabase;
beforeAll(async () => {
	t = await createTestDatabase();
});
afterAll(async () => {
	await t.dispose();
});

describe('export after a person was merged away', () => {
	it('writes kept lines against the survivor, with no pointer to the gone record', async () => {
		const treeId = crypto.randomUUID();
		await importGedcomToDb(t.d1, treeId, FILE, 'Aliases');
		const survivor = `${treeId}:@I1@`;
		// What the merge leaves: the other person's row is gone and the survivor carries their XREF.
		await t.db.delete(individuals).where(eq(individuals.id, `${treeId}:@I2@`));
		await t.db.update(individuals).set({ xrefAliases: ['@I2@'] }).where(eq(individuals.id, survivor));

		const text = buildGedcom551String(await getTreeExportData(t.d1, treeId)).replace(/\r\n/g, '\n');
		expect(text).not.toContain('@I2@');
		// "Third" pointed at the gone person; it now points at the survivor.
		expect(text).toMatch(/1 ASSO @I1@\n2 RELA neighbour/);
		// What was kept under the gone person is kept under the survivor.
		expect(text).toContain('_CUSTOM kept on two');
		expect(text).toContain('_CUSTOM kept on one');
		const keepBlock = text.split('\n0 ').find((block) => block.startsWith('@I1@'))!;
		expect(keepBlock).toContain('_CUSTOM kept on two');
	});

	it('leaves a pointer alone when nobody absorbed the record it names', async () => {
		const treeId = crypto.randomUUID();
		await importGedcomToDb(t.d1, treeId, FILE, 'No aliases');
		const text = buildGedcom551String(await getTreeExportData(t.d1, treeId)).replace(/\r\n/g, '\n');
		expect(text).toMatch(/1 ASSO @I2@\n2 RELA neighbour/);
	});
});
