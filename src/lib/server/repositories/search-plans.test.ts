import { SQLiteSyncDialect } from 'drizzle-orm/sqlite-core';
import type { SQL } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { trees } from '../db/schema';
import { insertCorpus, type CorpusSummary } from '../testing/corpus';
import { createTestDatabase, type TestDatabase } from '../testing/d1';
import { SearchRepository, xrefCandidates, type SearchFilters } from './search-repository';

let t: TestDatabase;
beforeAll(async () => {
	t = await createTestDatabase();
});
afterAll(async () => {
	await t.dispose();
});

interface Plan {
	name: string;
	sql: string;
	details: string[];
	returned: number;
	rowsRead: number;
}

/**
 * Two trees in one database, one much smaller than the other. On one tree a query that scans every
 * tree and one that scans a single tree read the same rows, so the small tree is the witness: a
 * query that reads the big tree's rows to answer the small tree would read far more than the small
 * tree holds.
 */
const dialect = new SQLiteSyncDialect();

async function resultOf(statement: SQL): Promise<unknown[]> {
	const { sql, params } = dialect.sqlToQuery(statement);
	return (await t.d1.prepare(sql).bind(...params).all()).results;
}
async function measure(name: string, statement: SQL): Promise<Plan> {
	const { sql, params } = dialect.sqlToQuery(statement);
	const plan = await t.d1.prepare(`EXPLAIN QUERY PLAN ${sql}`).bind(...params).all<{ detail: string }>();
	const run = await t.d1.prepare(sql).bind(...params).run();
	return { name, sql, details: plan.results.map((r) => r.detail), returned: run.results.length, rowsRead: run.meta.rows_read };
}

/** Plan lines that read a named table from its first row to its last. A CTE or subquery is not a table. */
const tableScans = (details: string[]) => details.filter((d) => /^SCAN (?!cand|scored|best|\(subquery)/.test(d));

/** Owners, managers and editors: no visibility predicate. Contributors and viewers: the predicate, cut at a fixed day. */
const EVERYONE = { isRestricted: false, cutoff: '1906-10-01', creatorId: null };
// A viewer has no creator test; a contributor's predicate also asks `created_by`, so both are measured.
const VIEWER = { isRestricted: true, cutoff: '1906-10-01', creatorId: null as string | null };
const CONTRIBUTOR = { ...VIEWER, creatorId: 'a-contributor' };

const FILTERS: Array<[string, Partial<SearchFilters>]> = [
	['name, two words', { words: ['ann', 'brown'] }],
	['name, one letter', { words: ['a'] }],
	['surname with a stored married name', { words: ['ashson'] }],
	['place', { place: 'cork' }],
	['year range', { from: '1850', to: '1860' }],
	['place and year range', { place: 'cork', from: '1850', to: '1860' }],
	['name and place and year range', { words: ['ann'], place: 'cork', from: '1850', to: '1860' }]
];

describe('the search queries, against two trees of different size', () => {
	it('read one tree, never a scan of a table, in proportion to that tree', async () => {
		const big = crypto.randomUUID();
		const small = crypto.randomUUID();
		await t.db.insert(trees).values({ id: big, name: 'Big' });
		await t.db.insert(trees).values({ id: small, name: 'Small' });
		await insertCorpus(t.db, big, { prefix: big.slice(0, 8), shouldNameThePeople: true });
		const smallSummary: CorpusSummary = await insertCorpus(t.db, small, { prefix: small.slice(0, 8), shouldNameThePeople: true, seed: 7, lineages: 2, generations: 7 });

		const count = async (table: string, column: string, id: string) =>
			(await t.d1.prepare(`select count(*) c from ${table} where ${column} = ?`).bind(id).first<{ c: number }>())!.c;
		const smallPeople = await count('individuals', 'tree_id', small);
		const smallNames = (await t.d1.prepare('select count(*) c from person_names n join individuals i on i.id = n.person_id where i.tree_id = ?').bind(small).first<{ c: number }>())!.c;
		const smallEvents = await count('events', 'tree_id', small);
		const bigPeople = await count('individuals', 'tree_id', big);
		expect(smallSummary.people).toBe(smallPeople);
		expect(bigPeople).toBeGreaterThan(smallPeople * 3);

		const repo = new SearchRepository(t.db);
		const plans: Plan[] = [];
		for (const [name, partial] of FILTERS) {
			const filters: SearchFilters = { words: [], place: '', from: '', to: '', limit: 25, offset: 0, ...partial };
			plans.push(await measure(`${name} (small tree)`, repo.findSql(small, filters, EVERYONE)));
			plans.push(await measure(`${name} (big tree)`, repo.findSql(big, filters, EVERYONE)));
			plans.push(await measure(`${name}, restricted viewer (small tree)`, repo.findSql(small, filters, VIEWER)));
			plans.push(await measure(`${name}, restricted viewer (big tree)`, repo.findSql(big, filters, VIEWER)));
			plans.push(await measure(`${name}, restricted contributor (small tree)`, repo.findSql(small, filters, CONTRIBUTOR)));
			plans.push(await measure(`${name}, restricted contributor (big tree)`, repo.findSql(big, filters, CONTRIBUTOR)));
			// Nobody here created anyone, so the creator test may change the cost and never the answer. Compared
			// without a page limit: ties in the ranking are cut at the limit in whatever order the plan reads them.
			const everything = { ...filters, limit: 5000 };
			const idsOf = async (treeId: string, scope: typeof VIEWER) => (await resultOf(repo.findSql(treeId, everything, scope)) as { id: string }[]).map((r) => r.id).sort();
			for (const treeId of [small, big]) expect(await idsOf(treeId, CONTRIBUTOR), name).toEqual(await idsOf(treeId, VIEWER));
		}
		plans.push(await measure('XREF (small tree)', repo.xrefSql(small, xrefCandidates('@I12@'), EVERYONE)));
		plans.push(await measure('XREF, restricted viewer (small tree)', repo.xrefSql(small, xrefCandidates('@I12@'), VIEWER)));

		if (process.env.WRITE_QUERY_PLANS) {
			const lines = [`Small tree: ${smallPeople} people, ${smallNames} names, ${smallEvents} events. Big tree: ${bigPeople} people.`];
			for (const p of plans) lines.push(`${p.name}\n${p.details.map((d) => `  -> ${d}`).join('\n')}\n  rows returned ${p.returned}, rows read ${p.rowsRead}`);
			// @ts-expect-error @types/node is not installed; this only runs when regenerating the doc.
			const { appendFileSync } = await import('node:fs');
			appendFileSync(process.env.WRITE_QUERY_PLANS, lines.join('\n\n') + '\n');
		}

		// A tree's own size is the ceiling for a query over it. The small tree is under a fifth of
		// the big one, so a query that also read the big tree's rows blows through this.
		// The visibility predicate adds two event lookups per candidate (ADR-015), so a restricted
		// viewer's ceiling is higher; it is still the small tree's own size, never the big tree's.
		const ceiling = 6 * (smallPeople + smallNames + smallEvents);
		const restrictedCeiling = 12 * (smallPeople + smallNames + smallEvents);
		for (const plan of plans) {
			expect(tableScans(plan.details), `${plan.name}: ${plan.details.join(' | ')}`).toEqual([]);
			if (plan.name.endsWith('(small tree)')) {
				const limit = plan.name.includes('restricted') ? restrictedCeiling : ceiling;
				expect(plan.rowsRead, `${plan.name} read ${plan.rowsRead} rows, tree holds ${smallPeople + smallNames + smallEvents}`).toBeLessThanOrEqual(limit);
			}
		}
		expect(plans.find((p) => p.name === 'XREF (small tree)')!.rowsRead).toBeLessThanOrEqual(10);

	}, 240_000);
});
