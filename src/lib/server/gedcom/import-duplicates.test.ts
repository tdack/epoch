import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import dirty from '../../../../docs/The_Simpsons.ged?raw';
import { parentChild, unions } from '../db/schema';
import { createTestDatabase, type TestDatabase } from '../testing/d1';
import { buildGedcom551String, parseGedcom } from './index';
import { getTreeExportData, importGedcomToDb, previewGedcomFile, previewGedcomImport } from './importer';

let t: TestDatabase;
beforeAll(async () => {
	t = await createTestDatabase();
});
afterAll(async () => {
	await t.dispose();
});

const unionsOf = (treeId: string) => t.db.select().from(unions).where(eq(unions.treeId, treeId)).all();

describe('importing The_Simpsons.ged (dirty)', () => {
	it('previews the duplicate families for a new tree, without touching the database', () => {
		const preview = previewGedcomFile(dirty);
		expect(preview.mode).toBe('replace');
		expect(preview.duplicates.exact).toHaveLength(2);
		expect(preview.duplicates.possible.length).toBeGreaterThan(0);
	});

	it('previews the same for an existing tree', async () => {
		const treeId = crypto.randomUUID();
		await importGedcomToDb(t.d1, treeId, '0 HEAD\n0 TRLR', 'Empty');
		expect((await previewGedcomImport(t.d1, treeId, dirty)).duplicates.exact).toHaveLength(2);
	});

	it('writes the file as it is when the option is off: ten unions, empty copies and all', async () => {
		const treeId = crypto.randomUUID();
		const result = await importGedcomToDb(t.d1, treeId, dirty, 'As written');
		expect(result.mergedFamiliesCount).toBe(0);
		expect(await unionsOf(treeId)).toHaveLength(10);
	});

	it('merges the exact duplicates when asked: one Homer–Marge union holding every child, XREFs kept as aliases', async () => {
		const treeId = crypto.randomUUID();
		const result = await importGedcomToDb(t.d1, treeId, dirty, 'Merged', 'replace', { shouldMergeDuplicateFamilies: true });
		expect(result.mergedFamiliesCount).toBe(3);

		const rows = await unionsOf(treeId);
		expect(rows).toHaveLength(7);
		const survivor = rows.find((u) => u.id.endsWith('@F_d9d0076c@'))!;
		expect(survivor.xrefAliases).toEqual(['@F_ac5bd259@', '@F_d88ca04a@']);
		expect(rows.find((u) => u.id.endsWith('@F_87948dab@'))!.xrefAliases).toEqual(['@F_ba9969ea@']);

		const links = await t.db.select().from(parentChild).where(eq(parentChild.unionId, survivor.id)).all();
		expect(new Set(links.map((l) => l.childId.split(':')[1]))).toEqual(
			new Set(['@I_c2773035@', '@I_7e044ae1@', '@I_36d204ee@', '@I_547728f0@'])
		);
	});

	it('exports the merged tree with the aliases as REFN and reads back the same aliases', async () => {
		const treeId = crypto.randomUUID();
		await importGedcomToDb(t.d1, treeId, dirty, 'Round trip', 'replace', { shouldMergeDuplicateFamilies: true });
		const text = buildGedcom551String(await getTreeExportData(t.d1, treeId));

		expect(text.match(/^0 @F_[0-9a-f]+@ FAM/gm)).toHaveLength(7);
		expect(text).toContain('1 REFN F_ac5bd259\r\n2 TYPE epoch-merged-family');
		const again = parseGedcom(text);
		expect(again.families.find((f) => f.id === '@F_d9d0076c@')!.aliases).toEqual(['@F_ac5bd259@', '@F_d88ca04a@']);
		expect(again.families.find((f) => f.id === '@F_87948dab@')!.aliases).toEqual(['@F_ba9969ea@']);
	});
});
