import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import namesFixture from '../../../../docs/The_Names_fixture.ged?raw';
import { personNames } from '../db/schema';
import { importGedcomToDb } from '../gedcom/importer';
import { graphFromRows } from '../domain/relationship-graph';
import { ChangeStore } from '../repositories/change-store';
import { GraphWindowRepository } from '../repositories/graph-window-repository';
import { RelationshipRepository } from '../repositories/relationship-repository';
import { createTestDatabase, type TestDatabase } from '../testing/d1';
import { loadFocusWindow } from './focus-window';
import { personSummaries } from './person-summaries';

let t: TestDatabase;
beforeAll(async () => {
	t = await createTestDatabase();
});
afterAll(async () => {
	await t.dispose();
});

/** The fixture with Jessica going by her married name, as a person who took it would. */
async function married() {
	const treeId = crypto.randomUUID();
	await importGedcomToDb(t.d1, treeId, namesFixture, 'Names');
	const rows = await t.db.select().from(personNames).where(eq(personNames.personId, `${treeId}:@I1@`)).all();
	await t.db.update(personNames).set({ isPreferred: false }).where(eq(personNames.id, rows.find((r) => r.type === 'birth')!.id));
	await t.db.update(personNames).set({ isPreferred: true }).where(eq(personNames.id, rows.find((r) => r.type === 'married')!.id));
	// The mirrored display name, as set_preferred_name would have written it.
	await t.d1.prepare('UPDATE individuals SET surname = ? WHERE id = ?').bind('Smith', `${treeId}:@I1@`).run();
	return treeId;
}

describe('the display name says "(née …)"', () => {
	it('on every card of the whole-tree graph', async () => {
		const treeId = await married();
		const graph = graphFromRows(await new ChangeStore(t.db).loadRows(treeId));
		const byId = new Map(graph.people.map((p) => [p.id, p.displayName]));
		expect(byId.get(`${treeId}:@I1@`)).toBe('Jessica Louise Wren (née Simpson)');
		// Only a birth or maiden name that differs adds it: a _MARNM or aka name does not.
		expect(byId.get(`${treeId}:@I3@`)).toBe('Ann Brown');
	});

	it('the same in the bounded window as in the whole tree, for every person as focus', async () => {
		const treeId = await married();
		const whole = new Map(graphFromRows(await new ChangeStore(t.db).loadRows(treeId)).people.map((p) => [p.id, p.displayName]));
		const repo = new GraphWindowRepository(t.db);
		for (const id of whole.keys()) {
			const { graph } = await loadFocusWindow(repo, treeId, id, { ancestorDepth: 2, descendantDepth: 2 });
			for (const p of graph.people) expect(p.displayName, `${id} → ${p.id}`).toBe(whole.get(p.id));
		}
	});

	it('for a person the window only names, in the record pages\' summaries', async () => {
		const treeId = await married();
		const repo = new GraphWindowRepository(t.db);
		const empty = { people: [], unions: [], parentChild: [] };
		const summaries = await personSummaries(repo, treeId, empty, [`${treeId}:@I1@`]);
		expect(summaries.get(`${treeId}:@I1@`)?.displayName).toBe('Jessica Louise Wren (née Simpson)');
	});
});

describe('search matches every name', () => {
	it('finds a person by a name they no longer go by, and by "Given Surname"', async () => {
		const treeId = await married();
		const search = new RelationshipRepository(t.db);
		expect((await search.searchPeople(treeId, 'Simpson')).map((p) => p.id)).toContain(`${treeId}:@I1@`);
		expect((await search.searchPeople(treeId, 'Jessica Wren')).map((p) => p.id)).toEqual([`${treeId}:@I1@`]);

		// Smith is the display name now; the same person by the old name matches through the row.
		const viaOld = await search.searchPeople(treeId, 'Jessica Louise Lovejoy');
		expect(viaOld).toMatchObject([{ id: `${treeId}:@I1@`, matchedName: 'Jessica Louise Lovejoy' }]);
		expect((await search.searchPeople(treeId, 'Carter')).map((p) => p.id)).toEqual([`${treeId}:@I3@`]);
	});

	it('does not leak across trees, and treats % and _ as text', async () => {
		const a = await married();
		const b = await married();
		const search = new RelationshipRepository(t.db);
		expect((await search.searchPeople(a, 'Carter')).every((p) => p.id.startsWith(a))).toBe(true);
		expect(await search.searchPeople(b, '%')).toEqual([]);
		expect(await search.searchPeople(b, 'Sharl_en')).toEqual([]);
	});
});
