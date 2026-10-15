/**
 * The trees the scoped-snapshot proofs run on (ADR-055): the GEDCOM fixtures and a generated corpus,
 * each with sources, citations, notes, tasks and files spread over it, loaded once as whole
 * `TreeRows` and moved into `TEST_TREE_ID`, which the planners check rows against.
 */

import duplicateFamilies from '../../../../test/data/The Simpsons duplicate families.ged?raw';
import simpsonsNames from '../../../../test/data/The Simpsons names.ged?raw';
import simpsons from '../../../../test/data/The Simpsons.ged?raw';
import { REPRESENTATIVE_GEDCOM_FIXTURE } from '../fixtures/genealogy-fixtures';
import type { TreeRows } from '../domain/change-log';
import { ChangeStore } from '../repositories/change-store';
import { insertCorpus } from './corpus';
import { createTestDatabase, createTestTree, createTestUser, type TestDatabase } from './d1';
import { addEvidence, seededRandom } from './evidence-fixtures';
import { importGedcomToDb } from './gedcom';
import { TEST_TREE_ID } from './rows';

export const CREATOR_ID = 'creator-1';

export interface World {
	label: string;
	rows: TreeRows;
}

/**
 * Rows moved into the tree the planners plan for. Every fourth person is the contributor's, so
 * the contributor scope differs from the restricted one.
 */
export function prepared(rows: TreeRows): TreeRows {
	const moved = Object.fromEntries(
		Object.entries(rows).map(([table, list]) => [
			table,
			(list as Array<Record<string, unknown>>).map((row) =>
				'treeId' in row ? { ...row, treeId: TEST_TREE_ID } : row
			)
		])
	) as unknown as TreeRows;
	return {
		...moved,
		individuals: moved.individuals.map((p, index) =>
			index % 4 === 0 ? { ...p, createdBy: CREATOR_ID } : p
		)
	};
}

export async function createWorlds(): Promise<{ t: TestDatabase; worlds: World[] }> {
	const t = await createTestDatabase();
	const actor = await createTestUser(t.db);
	const store = new ChangeStore(t.db);
	const worlds: World[] = [];
	const imports: Array<[string, string]> = [
		['Simpsons', simpsons],
		['Simpsons duplicate families', duplicateFamilies],
		['Simpsons names', simpsonsNames],
		['Representative', REPRESENTATIVE_GEDCOM_FIXTURE]
	];
	for (const [index, [label, gedcom]] of imports.entries()) {
		const treeId = await createTestTree(t.db, actor);
		await importGedcomToDb(t.d1, treeId, gedcom, label);
		await addEvidence(t.db, treeId, await store.loadRows(treeId), seededRandom(31 + index));
		worlds.push({ label, rows: prepared(await store.loadRows(treeId)) });
	}
	const treeId = await createTestTree(t.db, actor);
	await insertCorpus(t.db, treeId, {
		prefix: treeId.slice(0, 8),
		lineages: 2,
		generations: 6,
		shouldNameThePeople: true
	});
	await addEvidence(t.db, treeId, await store.loadRows(treeId), seededRandom(47));
	worlds.push({ label: 'Corpus', rows: prepared(await store.loadRows(treeId)) });
	return { t, worlds };
}
