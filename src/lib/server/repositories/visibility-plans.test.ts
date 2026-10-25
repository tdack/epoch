import { SQLiteSyncDialect } from 'drizzle-orm/sqlite-core';
import { sql, type SQL } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { citations, sources, trees } from '../db/schema';
import { insertCorpus } from '../testing/corpus';
import { createTestDatabase, type TestDatabase } from '../testing/d1';
import { EvidenceRepository } from './evidence-repository';
import { chunkByParamLimit } from './param-chunks';
import { andSourceVisible, withVisibleNoteScope, withVisiblePeople } from './visibility';

let t: TestDatabase;
beforeAll(async () => {
	t = await createTestDatabase();
});
afterAll(async () => {
	await t.dispose();
});

const dialect = new SQLiteSyncDialect();
const VIEWER = { isRestricted: true, cutoff: '1906-10-01', creatorId: null as string | null };
const CONTRIBUTOR = { ...VIEWER, creatorId: 'a-contributor' };

async function measure(statement: SQL) {
	const query = dialect.sqlToQuery(statement);
	const plan = await t.d1
		.prepare(`EXPLAIN QUERY PLAN ${query.sql}`)
		.bind(...query.params)
		.all<{ detail: string }>();
	const run = await t.d1
		.prepare(query.sql)
		.bind(...query.params)
		.all<{ id: string }>();
	return {
		details: plan.results.map((r) => r.detail).join(' | '),
		ids: run.results.map((r) => r.id),
		rowsRead: run.meta.rows_read
	};
}

async function newTree(seed: number) {
	const id = crypto.randomUUID();
	await t.db.insert(trees).values({ id, name: `Tree ${seed}` });
	await insertCorpus(t.db, id, { prefix: id.slice(0, 8), seed, lineages: 2, generations: 7 });
	return id;
}

describe('restricted checks of a few records', () => {
	it('test one source against its own citations, by idx_citation_source', async () => {
		const treeId = await newTree(11);
		const people = (
			await t.d1
				.prepare('select id from individuals where tree_id = ? order by rowid')
				.bind(treeId)
				.all<{ id: string }>()
		).results.map((r) => r.id);
		const [wide, narrow] = [`${treeId}:s-wide`, `${treeId}:s-narrow`];
		await t.db.insert(sources).values([
			{ id: wide, treeId, title: 'Cites everyone' },
			{ id: narrow, treeId, title: 'Cites three' }
		]);
		const rows = people.map((p, i) => ({
			id: `${treeId}:c${i}`,
			treeId,
			subjectKind: 'person' as const,
			subjectId: p,
			sourceId: i < 3 ? narrow : wide
		}));
		for (const chunk of chunkByParamLimit(rows, 30)) await t.db.insert(citations).values(chunk);

		const repo = new EvidenceRepository(t.db);
		for (const scope of [VIEWER, CONTRIBUTOR]) {
			const one = await measure(repo.visibleSourceSql(treeId, narrow, scope));
			expect(one.details).toMatch(/idx_citation_source/);
			expect(one.details).not.toMatch(/idx_citation_tree/);
			// The tree-wide form the lists use, for the same one source, reads every citation.
			const wideForm = await measure(
				sql`${withVisiblePeople(treeId, scope)}select s.id as id from sources s where s.tree_id = ${treeId} and s.id = ${narrow}${andSourceVisible('s', scope, treeId)}`
			);
			expect(one.ids).toEqual(wideForm.ids);
			expect(one.rowsRead).toBeLessThan(wideForm.rowsRead - people.length / 2);
		}
	}, 60_000);

	it('find the partnerships with a hidden partner among the tree’s own unions only', async () => {
		const [mine, other] = [await newTree(12), await newTree(13)];
		// A cutoff before anyone's birth: everyone without a death is taken as living, so many partners are hidden.
		const scope = { ...VIEWER, cutoff: '0001-01-01' };
		const hidden = (treeId: string) =>
			measure(sql`${withVisibleNoteScope(treeId, scope)}select id from hu`);
		const [a, b] = [await hidden(mine), await hidden(other)];
		// Both trees have living partners, so a test without the tree would mix them.
		expect(a.ids.length).toBeGreaterThan(0);
		expect(b.ids.length).toBeGreaterThan(0);
		expect(a.ids.every((id) => id.startsWith(mine.slice(0, 8)))).toBe(true);
		expect(a.details).not.toMatch(/SCAN up\b/);
	}, 60_000);
});
