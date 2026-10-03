import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { individuals } from '../db/schema';
import {
	createTestDatabase,
	createTestTree,
	createTestUser,
	type TestDatabase
} from '../testing/d1';
import { GenealogyService } from '../services/genealogy-service';
import { parseGedcom } from './parser';
import { buildGedcom551String, buildGedcom7String } from './serializer';
import { getTreeExportData, importGedcomToDb } from './importer';

let t: TestDatabase;
beforeAll(async () => {
	t = await createTestDatabase();
});
afterAll(async () => {
	await t.dispose();
});

const ged = ['0 HEAD', '0 @I1@ INDI', '1 NAME Sam /Xu/', '1 SEX X', '0 TRLR'].join('\n');
const sexesOf = async (treeId: string) =>
	(await t.db.select().from(individuals).where(eq(individuals.treeId, treeId)).all()).map(
		(i) => i.sex
	);

describe('sex X end to end (ADR-010)', () => {
	it('is stored as X on import, not as U', async () => {
		const treeId = crypto.randomUUID();
		await importGedcomToDb(t.d1, treeId, ged, 'X');
		expect(await sexesOf(treeId)).toEqual(['X']);
	});

	it('survives an export and re-import in both GEDCOM versions', async () => {
		const first = crypto.randomUUID();
		await importGedcomToDb(t.d1, first, ged, 'X');
		const data = await getTreeExportData(t.d1, first);
		for (const build of [buildGedcom7String, buildGedcom551String]) {
			const again = crypto.randomUUID();
			await importGedcomToDb(t.d1, again, build(data), 'X again');
			expect(await sexesOf(again)).toEqual(['X']);
		}
		expect(parseGedcom(buildGedcom551String(data)).individuals[0].sex).toBe('X');
	});

	it('can be created and edited through the service', async () => {
		const actor = await createTestUser(t.db);
		const treeId = await createTestTree(t.db, actor);
		const service = new GenealogyService(t.db);
		const { individual } = await service.createIndividual(
			treeId,
			{ givenName: 'Sam', sex: 'X' },
			actor.context
		);
		expect(await sexesOf(treeId)).toEqual(['X']);
		await service.updateIndividual(
			treeId,
			individual.id,
			individual.version,
			{ sex: 'U' },
			actor.context
		);
		expect(await sexesOf(treeId)).toEqual(['U']);
	});
});
