import { SQLiteSyncDialect } from 'drizzle-orm/sqlite-core';
import type { SQL } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { trees } from '../db/schema';
import { insertCorpus } from '../testing/corpus';
import { createTestDatabase, type TestDatabase } from '../testing/d1';
import { PlaceRepository } from './place-repository';

let t: TestDatabase;
beforeAll(async () => {
	t = await createTestDatabase();
});
afterAll(async () => {
	await t.dispose();
});

const dialect = new SQLiteSyncDialect();
const EVERYONE = { isRestricted: false, cutoff: '1906-10-01', creatorId: null };
const VIEWER = { isRestricted: true, cutoff: '1906-10-01', creatorId: null as string | null };
const CONTRIBUTOR = { ...VIEWER, creatorId: 'a-contributor' };

interface Plan {
	name: string;
	details: string[];
	returned: number;
	rowsRead: number;
}
async function measure(name: string, statement: SQL): Promise<Plan> {
	const { sql, params } = dialect.sqlToQuery(statement);
	const plan = await t.d1
		.prepare(`EXPLAIN QUERY PLAN ${sql}`)
		.bind(...params)
		.all<{ detail: string }>();
	const run = await t.d1
		.prepare(sql)
		.bind(...params)
		.run();
	return {
		name,
		details: plan.results.map((r) => r.detail),
		returned: run.results.length,
		rowsRead: run.meta.rows_read
	};
}
async function rowsOf(statement: SQL): Promise<unknown[]> {
	const { sql, params } = dialect.sqlToQuery(statement);
	return (
		await t.d1
			.prepare(sql)
			.bind(...params)
			.all()
	).results;
}

describe('the place queries, against two trees of different size', () => {
	it('read one tree, use the place index for a place, and answer a contributor as a viewer', async () => {
		const big = crypto.randomUUID();
		const small = crypto.randomUUID();
		await t.db.insert(trees).values({ id: big, name: 'Big' });
		await t.db.insert(trees).values({ id: small, name: 'Small' });
		await insertCorpus(t.db, big, { prefix: big.slice(0, 8), shouldNameThePeople: true });
		await insertCorpus(t.db, small, {
			prefix: small.slice(0, 8),
			shouldNameThePeople: true,
			seed: 7,
			lineages: 2,
			generations: 7
		});
		const count = async (treeId: string) =>
			(await t.d1
				.prepare('select count(*) n from events where tree_id = ?')
				.bind(treeId)
				.first<{ n: number }>())!.n;
		const smallEvents = await count(small);
		const bigEvents = await count(big);
		expect(bigEvents).toBeGreaterThan(smallEvents * 3);

		const repo = new PlaceRepository(t.db);
		const page = { offset: 0, limit: 50 };
		const plans: Plan[] = [];
		for (const [label, scope] of [
			['', EVERYONE],
			[', restricted viewer', VIEWER],
			[', restricted contributor', CONTRIBUTOR]
		] as const) {
			for (const [size, treeId] of [
				['small', small],
				['big', big]
			] as const) {
				const common = (await t.d1
					.prepare(
						"select place from events where tree_id = ? and place is not null and place <> '' group by place order by count(*) desc limit 1"
					)
					.bind(treeId)
					.first<{ place: string }>())!.place;
				plans.push(
					await measure(
						`place list, first page${label} (${size})`,
						repo.listSql(treeId, '', page, scope)
					)
				);
				plans.push(
					await measure(
						`place list, filtered${label} (${size})`,
						repo.listSql(treeId, common.slice(0, 4), page, scope)
					)
				);
				plans.push(
					await measure(
						`facts at one place${label} (${size})`,
						repo.factsSql(treeId, common, page, scope)
					)
				);
			}
		}
		for (const treeId of [small, big]) {
			const common = (await t.d1
				.prepare(
					"select place from events where tree_id = ? and place is not null and place <> '' group by place order by count(*) desc limit 1"
				)
				.bind(treeId)
				.first<{ place: string }>())!.place;
			for (const read of [
				(s: typeof VIEWER) => repo.listSql(treeId, '', { offset: 0, limit: 5000 }, s),
				(s: typeof VIEWER) => repo.factsSql(treeId, common, { offset: 0, limit: 5000 }, s)
			]) {
				expect(await rowsOf(read(CONTRIBUTOR))).toEqual(await rowsOf(read(VIEWER)));
			}
		}

		if (process.env.WRITE_QUERY_PLANS) {
			const lines = [`Small tree: ${smallEvents} events. Big tree: ${bigEvents}.`];
			for (const p of plans)
				lines.push(
					`${p.name}\n${p.details.map((d) => `  -> ${d}`).join('\n')}\n  rows returned ${p.returned}, rows read ${p.rowsRead}`
				);
			// @ts-expect-error @types/node is not installed; this only runs when regenerating the doc.
			const { appendFileSync } = await import('node:fs');
			appendFileSync(process.env.WRITE_QUERY_PLANS, lines.join('\n\n') + '\n');
		}
		for (const plan of plans) {
			expect(
				plan.details.filter((d) => /^SCAN (?!f\b|\(subquery)/.test(d)),
				`${plan.name}: ${plan.details.join(' | ')}`
			).toEqual([]);
			const size = plan.name.endsWith('(small)') ? smallEvents : bigEvents;
			// One tree's events at most: a restricted viewer looks up each fact's person on top (ADR-015).
			expect(plan.rowsRead, plan.name).toBeLessThanOrEqual(
				(plan.name.includes('restricted') ? 12 : 4) * size
			);
			if (plan.name.startsWith('facts at one place'))
				expect(plan.details.join(' '), plan.name).toContain('idx_event_place_id');
		}
	}, 240_000);
});
