import { SQLiteSyncDialect } from 'drizzle-orm/sqlite-core';
import type { SQL } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { trees } from '../db/schema';
import { insertCorpus } from '../testing/corpus';
import { createTestDatabase, type TestDatabase } from '../testing/d1';
import { ListRepository } from './list-repository';

let t: TestDatabase;
beforeAll(async () => {
	t = await createTestDatabase();
});
afterAll(async () => {
	await t.dispose();
});

const dialect = new SQLiteSyncDialect();
interface Plan {
	name: string;
	details: string[];
	returned: number;
	rowsRead: number;
}
async function measure(name: string, statement: SQL): Promise<Plan> {
	const { sql, params } = dialect.sqlToQuery(statement);
	const plan = await t.d1.prepare(`EXPLAIN QUERY PLAN ${sql}`).bind(...params).all<{ detail: string }>();
	const run = await t.d1.prepare(sql).bind(...params).run();
	return { name, details: plan.results.map((r) => r.detail), returned: run.results.length, rowsRead: run.meta.rows_read };
}
/** A CTE or subquery's own scan is not a table scan. */
const tableScans = (details: string[]) => details.filter((d) => /^SCAN (?!pairs|\(subquery)/.test(d));

describe('the list queries, against two trees of different size', () => {
	it('read a page for a page, and one tree for the aggregates', async () => {
		const big = crypto.randomUUID();
		const small = crypto.randomUUID();
		await t.db.insert(trees).values({ id: big, name: 'Big' });
		await t.db.insert(trees).values({ id: small, name: 'Small' });
		await insertCorpus(t.db, big, { prefix: big.slice(0, 8), shouldNameThePeople: true });
		await insertCorpus(t.db, small, { prefix: small.slice(0, 8), shouldNameThePeople: true, seed: 7, lineages: 2, generations: 7 });
		const count = async (treeId: string) => {
			const row = await t.d1
				.prepare('select (select count(*) from individuals where tree_id = ?1) p, (select count(*) from person_names n join individuals i on i.id = n.person_id where i.tree_id = ?1) n')
				.bind(treeId)
				.first<{ p: number; n: number }>();
			return row!.p + row!.n;
		};
		const smallSize = await count(small);
		const bigSize = await count(big);
		expect(bigSize).toBeGreaterThan(smallSize * 3);
		const surname = 'Ashton';

		const repo = new ListRepository(t.db);
		const page = { offset: 0, limit: 50 };
		const plans: Plan[] = [];
		for (const [label, treeId] of [['small', small], ['big', big]] as const) {
			plans.push(await measure(`individuals by surname, first page (${label})`, repo.individualsSql(treeId, 'surname', '', page)));
			plans.push(await measure(`individuals by given name, first page (${label})`, repo.individualsSql(treeId, 'given', '', page)));
			plans.push(await measure(`individuals by surname, page 100 (${label})`, repo.individualsSql(treeId, 'surname', '', { offset: 4950, limit: 50 })));
			plans.push(await measure(`individuals of one surname (${label})`, repo.individualsSql(treeId, 'surname', surname, page)));
			plans.push(await measure(`surname list (${label})`, repo.surnamesSql(treeId, page)));
			plans.push(await measure(`partnership list, first page (${label})`, repo.unionsSql(treeId, page)));
		}

		if (process.env.WRITE_QUERY_PLANS) {
			const lines = [`Small tree: ${smallSize} people plus names. Big tree: ${bigSize}.`];
			for (const p of plans) lines.push(`${p.name}\n${p.details.map((d) => `  -> ${d}`).join('\n')}\n  rows returned ${p.returned}, rows read ${p.rowsRead}`);
			// @ts-expect-error @types/node is not installed; this only runs when regenerating the doc.
			const { appendFileSync } = await import('node:fs');
			appendFileSync(process.env.WRITE_QUERY_PLANS, lines.join('\n\n') + '\n');
		}

		for (const plan of plans) {
			expect(tableScans(plan.details), `${plan.name}: ${plan.details.join(' | ')}`).toEqual([]);
			expect(plan.details.join(' '), plan.name).not.toContain('TEMP B-TREE FOR ORDER BY');
			const isSmall = plan.name.endsWith('(small)');
			const size = isSmall ? smallSize : bigSize;
			if (plan.name.includes('first page')) {
				// An index in the page's own order: a page costs a page, not the tree.
				expect(plan.rowsRead, plan.name).toBeLessThanOrEqual(2 * (page.limit + 1) + 10);
			} else if (plan.name.includes('surname list')) {
				expect(plan.rowsRead, plan.name).toBeLessThanOrEqual(10 * size);
			} else {
				// Deep pages and a surname filter still walk up to one tree, never more.
				expect(plan.rowsRead, plan.name).toBeLessThanOrEqual(3 * size);
			}
		}
	}, 240_000);
});
