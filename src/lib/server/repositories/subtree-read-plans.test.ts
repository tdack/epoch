/**
 * The scoped reads keep their plans when `inSubtree` is added beside `tree_id` and the visibility
 * predicate: no table scan outside the membership CTE, and no more than a tree's worth of rows read.
 * Same method as list-plans.test.ts and search-plans.test.ts, on one corpus tree.
 */

import { SQLiteSyncDialect } from 'drizzle-orm/sqlite-core';
import type { SQL } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { trees } from '../db/schema';
import { insertCorpus } from '../testing/corpus';
import { createTestDatabase, type TestDatabase } from '../testing/d1';
import { ListRepository } from './list-repository';
import { PlaceRepository } from './place-repository';
import { SearchRepository } from './search-repository';

let t: TestDatabase;
let treeId: string;
let rootId: string;
let treePeople: number;
beforeAll(async () => {
	t = await createTestDatabase();
	treeId = crypto.randomUUID();
	await t.db.insert(trees).values({ id: treeId, name: 'Lens' });
	await insertCorpus(t.db, treeId, { prefix: treeId.slice(0, 8), shouldNameThePeople: true });
	// The oldest person with at least one child: a root whose line is a real subset of the tree.
	rootId = (await t.d1
		.prepare(
			'select parent_id as id from parent_child where tree_id = ? group by parent_id order by min(rowid) limit 1'
		)
		.bind(treeId)
		.first<{ id: string }>())!.id;
	treePeople = (await t.d1
		.prepare('select count(*) c from individuals where tree_id = ?')
		.bind(treeId)
		.first<{ c: number }>())!.c;
}, 120_000);
afterAll(async () => {
	await t.dispose();
});

const dialect = new SQLiteSyncDialect();
const EVERYONE = { isRestricted: false, cutoff: '1906-10-01', creatorId: null };
const VIEWER = { isRestricted: true, cutoff: '1906-10-01', creatorId: null as string | null };
const page = { offset: 0, limit: 50 };

async function measure(statement: SQL) {
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
		params: params.length,
		details: plan.results.map((r) => r.detail),
		returned: run.results.length,
		rowsRead: run.meta.rows_read
	};
}

/**
 * The membership CTE (`line`, read as `l`), the places list's `f` relation, the one-row seed and the
 * FTS virtual table read through MATCH are not table scans.
 */
const tableScans = (details: string[]) =>
	details.filter(
		(d) =>
			/^SCAN (?!line|pairs|l$|f$|CONSTANT ROW|cand|scored|best|\(subquery)/.test(d) &&
			!/VIRTUAL TABLE INDEX \d+:M/.test(d)
	);

describe('scoped reads, with the lens fragment present', () => {
	it('keep the individuals list off table scans, and well under the 100-parameter cap', async () => {
		const repo = new ListRepository(t.db);
		for (const scope of [EVERYONE, VIEWER]) {
			for (const [label, statement] of [
				['by surname', repo.individualsSql(treeId, 'surname', '', page, scope, rootId)],
				['by given name', repo.individualsSql(treeId, 'given', '', page, scope, rootId)],
				['one surname', repo.individualsSql(treeId, 'surname', 'Ashton', page, scope, rootId)],
				['surnames', repo.surnamesSql(treeId, page, scope, rootId)],
				['unions', repo.unionsSql(treeId, page, scope, rootId)]
			] as const) {
				const plan = await measure(statement);
				const name = `${label}${scope.isRestricted ? ', restricted' : ''}`;
				expect(tableScans(plan.details), `${name}: ${plan.details.join(' | ')}`).toEqual([]);
				// The fragment binds the tree and root once each; the whole statement stays far from 100.
				expect(plan.params, name).toBeLessThanOrEqual(12);
				expect(plan.rowsRead, name).toBeLessThanOrEqual(12 * treePeople);
			}
		}
	}, 60_000);

	it('walks descent by idx_parent_child_parent, not the tree’s links', async () => {
		const plan = await measure(
			new ListRepository(t.db).individualsSql(treeId, 'surname', '', page, EVERYONE, rootId)
		);
		const details = plan.details.join('\n');
		expect(details).toContain('idx_parent_child_parent');
		expect(details).not.toContain('idx_parent_child_tree');
	});

	it('keep search and the finder off table scans', async () => {
		const repo = new SearchRepository(t.db);
		const base = { words: [] as string[], place: '', from: '', to: '', limit: 25, offset: 0 };
		for (const scope of [EVERYONE, VIEWER]) {
			for (const [label, filters] of [
				['name, two words', { ...base, words: ['ann', 'brown'] }],
				['name, one letter', { ...base, words: ['a'] }],
				['place', { ...base, place: 'cork' }],
				['name and place and years', { ...base, words: ['ann'], place: 'cork', from: '1850' }]
			] as const) {
				const plan = await measure(repo.findSql(treeId, filters, scope, rootId));
				const name = `${label}${scope.isRestricted ? ', restricted' : ''}`;
				expect(tableScans(plan.details), `${name}: ${plan.details.join(' | ')}`).toEqual([]);
				expect(plan.params, name).toBeLessThanOrEqual(30);
				expect(plan.rowsRead, name).toBeLessThanOrEqual(30 * treePeople);
			}
			const xref = await measure(repo.xrefSql(treeId, ['@I1@', 'I1'], scope, rootId));
			expect(tableScans(xref.details), xref.details.join(' | ')).toEqual([]);
		}
	}, 60_000);

	it('keep the places list off table scans', async () => {
		const repo = new PlaceRepository(t.db);
		for (const scope of [EVERYONE, VIEWER]) {
			const plan = await measure(repo.listSql(treeId, '', page, scope, rootId));
			expect(tableScans(plan.details), plan.details.join(' | ')).toEqual([]);
			expect(plan.params).toBeLessThanOrEqual(20);
		}
	}, 60_000);

	it('select only members: fewer rows than the tree, and the same rows as the unscoped list filtered', async () => {
		const repo = new ListRepository(t.db);
		const everyone = { offset: 0, limit: 100_000 };
		const { ids: all } = await repo.individualIds(treeId, 'surname', '', everyone, EVERYONE);
		const { ids: scoped } = await repo.individualIds(
			treeId,
			'surname',
			'',
			everyone,
			EVERYONE,
			rootId
		);
		expect(scoped.length).toBeGreaterThan(0);
		expect(scoped.length).toBeLessThan(all.length);
		// Same order: the lens removes rows, it does not reorder.
		const kept = new Set(scoped);
		expect(all.filter((id) => kept.has(id))).toEqual(scoped);
	}, 60_000);
});
