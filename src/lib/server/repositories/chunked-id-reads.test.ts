import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
	createTestDatabase,
	createTestTree,
	createTestUser,
	type TestDatabase
} from '../testing/d1';
import { SearchRepository } from './search-repository';
import { visibleAmong } from './visibility';

let t: TestDatabase;
beforeAll(async () => {
	t = await createTestDatabase();
});
afterAll(async () => {
	await t.dispose();
});

/** Restricted, with a creator: the scope that binds the most parameters beside the id list. */
const RESTRICTED = { isRestricted: true, cutoff: '1906-10-01', creatorId: 'someone' };
const PEOPLE = 450;
const PARIS = 300;

/**
 * Insert `PEOPLE` people with one recursive statement, since a multi-row insert would itself hit the
 * parameter cap: even-numbered ones public, odd-numbered ones private, each with a birth fact in
 * Paris (the first `PARIS` of them) or Rome, dated 1900.
 */
async function seedPeople(treeId: string): Promise<{ ids: string[]; publicIds: string[] }> {
	const run = (statement: string) => t.d1.prepare(statement).bind(treeId, PEOPLE, PARIS).run();
	const count = `with recursive n(i) as (select 0 union all select i + 1 from n where i + 1 < ?2)`;
	await run(
		`${count} insert into individuals (id, tree_id, given_name, privacy)
		select ?1 || '-p' || i, ?1, 'Given' || i, case when i % 2 = 0 then 'public' else 'private' end from n where ?3 >= 0`
	);
	await run(
		`${count} insert into events (id, tree_id, entity_type, entity_id, type, place, date_raw, date_sort, date_sort_end)
		select ?1 || '-e' || i, ?1, 'INDIVIDUAL', ?1 || '-p' || i, 'BIRT',
			case when i < ?3 then 'Paris, France' else 'Rome, Italy' end, '5 MAY 1900', '1900-05-05', '1900-05-05' from n`
	);
	const ids = Array.from({ length: PEOPLE }, (_, i) => `${treeId}-p${i}`);
	return { ids, publicIds: ids.filter((_, i) => i % 2 === 0) };
}

describe('visibleAmong with several hundred ids', () => {
	it('returns exactly the visible people, ignoring absent and repeated ids', async () => {
		const actor = await createTestUser(t.db, 'chunk-visible');
		const treeId = await createTestTree(t.db, actor);
		const { ids, publicIds } = await seedPeople(treeId);
		const asked = [
			...ids,
			...ids.slice(0, 20),
			...Array.from({ length: 30 }, () => crypto.randomUUID())
		];

		const seen = await visibleAmong(t.db, treeId, asked, RESTRICTED);

		expect([...seen].sort()).toEqual([...publicIds].sort());
	});

	it('returns every existing person for a viewer who sees everyone', async () => {
		const actor = await createTestUser(t.db, 'chunk-everyone');
		const treeId = await createTestTree(t.db, actor);
		const { ids } = await seedPeople(treeId);

		const seen = await visibleAmong(t.db, treeId, ids, { ...RESTRICTED, isRestricted: false });

		expect([...seen].sort()).toEqual([...ids].sort());
	});
});

describe('SearchRepository.factsMatching with several hundred ids', () => {
	it('finds the matching fact of every person across chunks, with every filter set', async () => {
		const actor = await createTestUser(t.db, 'chunk-facts');
		const treeId = await createTestTree(t.db, actor);
		const { ids } = await seedPeople(treeId);
		const matching = ids.slice(0, PARIS);

		const hits = await new SearchRepository(t.db).factsMatching(
			ids,
			'paris',
			'1890',
			'1910',
			RESTRICTED
		);

		expect(hits.map((h) => h.personId).sort()).toEqual([...matching].sort());
		expect(hits.every((h) => h.type === 'BIRT' && !h.isPartnershipFact)).toBe(true);
	});
});
