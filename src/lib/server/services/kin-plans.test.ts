import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getDb } from '../db';
import { GraphWindowRepository } from '../repositories/graph-window-repository';
import { insertCorpus, type CorpusSummary } from '../testing/corpus';
import { createTestDatabase, createTestTree, createTestUser, type TestDatabase } from '../testing/d1';
import { loadKinWindow } from './kin-window';

let t: TestDatabase;
let treeId: string;
let corpus: CorpusSummary;
beforeAll(async () => {
	t = await createTestDatabase();
	treeId = await createTestTree(t.db, await createTestUser(t.db, 'owner'));
	corpus = await insertCorpus(t.db, treeId, { prefix: treeId.slice(0, 8) });
	deep = await deepestDescendant();
}, 120_000);
afterAll(async () => {
	await t.dispose();
});

/** A D1 that adds up what its statements read, so a window's total cost is one number. */
function counting(d1: D1Database) {
	const tally = { rowsRead: 0, statements: 0, batches: 0 };
	const add = (result: { meta?: { rows_read?: number } }) => {
		tally.rowsRead += result.meta?.rows_read ?? 0;
		tally.statements += 1;
		return result;
	};
	const wrap = (statement: D1PreparedStatement): D1PreparedStatement =>
		new Proxy(statement, {
			get(target, prop) {
				if (prop === 'bind') return (...args: unknown[]) => wrap(target.bind(...args));
				if (prop === 'all' || prop === 'run') return async () => add(await (target as never as Record<string, () => Promise<{ meta?: { rows_read?: number } }>>)[prop]!());
				const value = Reflect.get(target, prop, target);
				return typeof value === 'function' ? value.bind(target) : value;
			}
		});
	const proxy = new Proxy(d1, {
		get(target, prop) {
			if (prop === 'prepare') return (query: string) => wrap(target.prepare(query));
			if (prop === 'batch') {
				return async (statements: D1PreparedStatement[]) => {
					tally.batches += 1;
					const results = await target.batch(statements);
					results.forEach(add);
					return results;
				};
			}
			const value = Reflect.get(target, prop, target);
			return typeof value === 'function' ? value.bind(target) : value;
		}
	});
	return { d1: proxy as D1Database, tally };
}

/** The founder's descendant furthest down, so the ancestor reads have the longest line to follow. */
async function deepestDescendant(): Promise<string> {
	const window = await loadKinWindow(new GraphWindowRepository(t.db), { treeId, startIds: [corpus.rootPersonId], ancestorGenerations: null, descendantGenerations: 20, partnersOf: 'none' });
	const children = new Map<string, string[]>();
	for (const l of window.rows.parentChild) children.set(l.parentId, [...(children.get(l.parentId) ?? []), l.childId]);
	let deepest = corpus.rootPersonId;
	for (let frontier = [corpus.rootPersonId]; frontier.length > 0; ) {
		deepest = frontier[0]!;
		frontier = frontier.flatMap((id) => children.get(id) ?? []);
	}
	return deepest;
}
let deep = '';

const SCENARIOS = [
	['ancestors of one person, 20 generations (relationship)', () => ({ startIds: [deep], ancestorGenerations: 20, descendantGenerations: null, partnersOf: 'starts' as const })],
	['ancestors of two people, 20 generations (relationship)', () => ({ startIds: [deep, corpus.remarriedPersonId], ancestorGenerations: 20, descendantGenerations: null, partnersOf: 'starts' as const })],
	['pedigree, 8 generations', () => ({ startIds: [deep], ancestorGenerations: 7, descendantGenerations: null, partnersOf: 'none' as const })],
	['descendants of a founder, 8 generations, with partners', () => ({ startIds: [corpus.rootPersonId], ancestorGenerations: null, descendantGenerations: 7, partnersOf: 'all' as const })]
] as const;

describe('the kin window, against a large tree', () => {
	it('reads rows in proportion to the people it loads, never to the tree', async () => {
		expect(corpus.people).toBeGreaterThan(4000);
		const report: string[] = [];
		for (const [name, request] of SCENARIOS) {
			const { d1, tally } = counting(t.d1);
			const window = await loadKinWindow(new GraphWindowRepository(getDb(d1)), { treeId, ...request() });
			const people = window.rows.individuals.length;
			report.push(`${name}: ${people} people loaded, ${tally.batches} batches, ${tally.statements} statements, rows read ${tally.rowsRead}`);
			// Each loaded person costs a handful of index rows (their record, links, events, names).
			expect(tally.rowsRead, name).toBeLessThanOrEqual(40 * people + 200);
			expect(people, name).toBeLessThan(corpus.people);
		}
		if (process.env.WRITE_QUERY_PLANS) {
			// @ts-expect-error @types/node is not installed; this only runs when regenerating the doc.
			const { appendFileSync } = await import('node:fs');
			appendFileSync(process.env.WRITE_QUERY_PLANS, report.join('\n') + '\n');
		}
	}, 120_000);
});
