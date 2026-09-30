import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { trees } from '../db/schema';
import { insertCorpus } from '../testing/corpus';
import { createTestDatabase, type TestDatabase } from '../testing/d1';
import { GraphWindowRepository } from './graph-window-repository';

let t: TestDatabase;
beforeAll(async () => {
	t = await createTestDatabase();
});
afterAll(async () => {
	await t.dispose();
});

interface PlanRow {
	detail: string;
}

/** What "read a few rows" means for a three-id lookup: a handful per id, never a share of the tree. */
const ROWS_READ_PER_RESULT = 4;
const ROWS_READ_OVERHEAD = 10;

describe('the bounded graph queries, against a large tree', () => {
	it('read rows in proportion to what they return, so no index beyond the existing ones is needed', async () => {
		const treeId = crypto.randomUUID();
		await t.db.insert(trees).values({ id: treeId, name: 'Plans' });
		const corpus = await insertCorpus(t.db, treeId, { prefix: treeId.slice(0, 8) });
		const personIds = [corpus.rootPersonId, corpus.remarriedPersonId, corpus.leafPersonId];
		const unionRows = await t.d1.prepare('select id from unions where tree_id = ? limit 3').bind(treeId).all<{ id: string }>();
		const unionIds = unionRows.results.map((r) => r.id);
		expect(corpus.people).toBeGreaterThan(4000);

		const statements = new GraphWindowRepository(t.db).statementsForPlans(treeId, { personIds, unionIds });
		const report: string[] = [];
		for (const [name, statement] of Object.entries(statements)) {
			const { sql, params } = (statement as unknown as { toSQL(): { sql: string; params: unknown[] } }).toSQL();
			const plan = await t.d1
				.prepare(`EXPLAIN QUERY PLAN ${sql}`)
				.bind(...params)
				.all<PlanRow>();
			const details = plan.results.map((r) => r.detail);
			const run = await t.d1
				.prepare(sql)
				.bind(...params)
				.run();
			const returned = run.results.length;
			report.push(
				`${name}\n  ${sql}\n${details.map((d) => `  -> ${d}`).join('\n')}\n  rows returned ${returned}, rows read ${run.meta.rows_read}`
			);

			// `SEARCH … USING INDEX idx_*_tree` is not a scan by SQLite's wording but walks every row of
			// the tree, so the plan text alone would pass a query that reads thousands of rows to
			// return three. D1 reports rows read, which is what a lookup actually costs.
			if (name.startsWith('count ')) continue; // Counting is linear in the tree by nature.
			expect(run.meta.rows_read, `${name} read ${run.meta.rows_read} rows for ${returned}`).toBeLessThanOrEqual(
				returned * ROWS_READ_PER_RESULT + ROWS_READ_OVERHEAD
			);
		}
		if (process.env.WRITE_QUERY_PLANS) {
			// @ts-expect-error @types/node is not installed; this only runs when regenerating the doc.
			const { appendFileSync } = await import('node:fs');
			appendFileSync(process.env.WRITE_QUERY_PLANS, report.join('\n\n') + '\n');
		}
	}, 120_000);
});
