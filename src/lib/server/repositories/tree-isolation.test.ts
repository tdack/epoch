import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { REPRESENTATIVE_GEDCOM_FIXTURE } from '../fixtures/genealogy-fixtures';
import { getTreeExportData, importGedcomToDb } from '../gedcom/importer';
import {
	createTestDatabase,
	createTestTree,
	createTestUser,
	type TestDatabase
} from '../testing/d1';
import { GenealogyService } from '../services/genealogy-service';

let t: TestDatabase;
beforeAll(async () => {
	t = await createTestDatabase();
});
afterAll(async () => {
	await t.dispose();
});

const TWO_PEOPLE =
	'0 HEAD\n0 @I1@ INDI\n1 NAME A /One/\n1 FAMS @F1@\n0 @I2@ INDI\n1 NAME B /Two/\n1 FAMS @F1@\n0 @F1@ FAM\n1 HUSB @I1@\n1 WIFE @I2@\n0 TRLR';

describe('one tree never reads another tree’s partners', () => {
	it('exports only its own partnerships', async () => {
		const [a, b] = [crypto.randomUUID(), crypto.randomUUID()];
		await importGedcomToDb(t.d1, a, TWO_PEOPLE, 'A');
		await importGedcomToDb(t.d1, b, REPRESENTATIVE_GEDCOM_FIXTURE, 'B');
		const exported = await getTreeExportData(t.d1, a);
		expect(exported.families).toHaveLength(1);
		expect(exported.families[0]).toMatchObject({
			husbandId: expect.stringContaining('I1'),
			wifeId: expect.stringContaining('I2')
		});
	});

	it('loads only its own partnerships for the tree details', async () => {
		const actor = await createTestUser(t.db);
		const treeId = await createTestTree(t.db, actor);
		await importGedcomToDb(t.d1, treeId, TWO_PEOPLE, 'A');
		await importGedcomToDb(t.d1, crypto.randomUUID(), REPRESENTATIVE_GEDCOM_FIXTURE, 'B');
		const details = await new GenealogyService(t.db).getTree(treeId, actor.context);
		expect(details.families).toHaveLength(1);
		expect(details.families[0]!.partner1Id).toContain('I1');
		expect(details.families[0]!.partner2Id).toContain('I2');
	});
});
