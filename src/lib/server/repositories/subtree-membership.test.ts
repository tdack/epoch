import { SQLiteSyncDialect } from 'drizzle-orm/sqlite-core';
import { sql, type SQL } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { individuals, parentChild, trees, unionPartners, unions } from '../db/schema';
import { createTestDatabase, type TestDatabase } from '../testing/d1';
import { insertCorpus } from '../testing/corpus';
import { andVisible } from './visibility';
import { inSubtree } from './subtree-membership';

let t: TestDatabase;
beforeAll(async () => {
	t = await createTestDatabase();
});
afterAll(async () => {
	await t.dispose();
});

const dialect = new SQLiteSyncDialect();

interface Link {
	parent: string;
	child: string;
	type?: 'biological' | 'adoptive' | 'foster' | 'guardian' | 'unknown';
	status?: 'active' | 'ended' | 'disputed';
}

/** A tree of the named people, with these links and partnerships (each a list of partner names). */
async function build(names: string[], links: Link[], partnerships: string[][] = []) {
	const treeId = crypto.randomUUID();
	await t.db.insert(trees).values({ id: treeId, name: 'T' });
	const id = (name: string) => `${treeId}:${name}`;
	for (const name of names)
		await t.db.insert(individuals).values({ id: id(name), treeId, givenName: name });
	for (const [i, l] of links.entries())
		await t.db.insert(parentChild).values({
			id: `${treeId}:link${i}`,
			treeId,
			parentId: id(l.parent),
			childId: id(l.child),
			type: l.type ?? 'biological',
			status: l.status ?? 'active'
		});
	for (const [i, partners] of partnerships.entries()) {
		const unionId = `${treeId}:union${i}`;
		await t.db.insert(unions).values({ id: unionId, treeId });
		for (const [order, p] of partners.entries())
			await t.db
				.insert(unionPartners)
				.values({ id: `${unionId}:${order}`, unionId, personId: id(p), order });
	}
	return { treeId, id };
}

async function members(treeId: string, rootId: string): Promise<string[]> {
	const statement = sql`select i.given_name as name from individuals i where i.tree_id = ${treeId}${inSubtree('i', treeId, rootId)} order by i.given_name`;
	const { sql: text, params } = dialect.sqlToQuery(statement);
	const rows = await t.d1
		.prepare(text)
		.bind(...params)
		.all<{ name: string }>();
	return rows.results.map((r) => r.name);
}

describe('inSubtree', () => {
	it('is the root and every descendant', async () => {
		const { treeId, id } = await build(
			['root', 'kid', 'grandkid', 'other'],
			[
				{ parent: 'root', child: 'kid' },
				{ parent: 'kid', child: 'grandkid' }
			]
		);
		expect(await members(treeId, id('root'))).toEqual(['grandkid', 'kid', 'root']);
		expect(await members(treeId, id('kid'))).toEqual(['grandkid', 'kid']);
	});

	it("adds partners of every member but not the partners' own parents or kin", async () => {
		const { treeId, id } = await build(
			['root', 'kid', 'kidspouse', 'spouse', 'spousedad', 'spousesibling', 'grandkid'],
			[
				{ parent: 'root', child: 'kid' },
				{ parent: 'kid', child: 'grandkid' },
				{ parent: 'spousedad', child: 'spouse' },
				{ parent: 'spousedad', child: 'spousesibling' },
				{ parent: 'spousedad', child: 'kidspouse' }
			],
			[
				['root', 'spouse'],
				['kid', 'kidspouse']
			]
		);
		expect(await members(treeId, id('root'))).toEqual([
			'grandkid',
			'kid',
			'kidspouse',
			'root',
			'spouse'
		]);
	});

	it("does not descend through a partner's other children", async () => {
		const { treeId, id } = await build(
			['root', 'spouse', 'stepchild'],
			[{ parent: 'spouse', child: 'stepchild' }],
			[['root', 'spouse']]
		);
		expect(await members(treeId, id('root'))).toEqual(['root', 'spouse']);
	});

	it('follows adoptive, foster, guardian and unknown links', async () => {
		const { treeId, id } = await build(
			['root', 'a', 'b', 'c', 'd'],
			[
				{ parent: 'root', child: 'a', type: 'adoptive' },
				{ parent: 'root', child: 'b', type: 'foster' },
				{ parent: 'root', child: 'c', type: 'guardian' },
				{ parent: 'root', child: 'd', type: 'unknown' }
			]
		);
		expect(await members(treeId, id('root'))).toEqual(['a', 'b', 'c', 'd', 'root']);
	});

	it('leaves out a child whose link is disputed, and that child’s line', async () => {
		const { treeId, id } = await build(
			['root', 'kid', 'doubted', 'doubtedkid'],
			[
				{ parent: 'root', child: 'kid' },
				{ parent: 'root', child: 'doubted', status: 'disputed' },
				{ parent: 'doubted', child: 'doubtedkid' }
			]
		);
		expect(await members(treeId, id('root'))).toEqual(['kid', 'root']);
	});

	it('ends on a cycle', async () => {
		const { treeId, id } = await build(
			['a', 'b', 'c'],
			[
				{ parent: 'a', child: 'b' },
				{ parent: 'b', child: 'c' },
				{ parent: 'c', child: 'a' }
			]
		);
		expect(await members(treeId, id('a'))).toEqual(['a', 'b', 'c']);
	});

	it('selects no one for a root of another tree, and not past the tree', async () => {
		const mine = await build(['x'], []);
		const theirs = await build(['root', 'kid'], [{ parent: 'root', child: 'kid' }]);
		expect(await members(mine.treeId, theirs.id('root'))).toEqual([]);
	});

	it('composes with the visibility predicate', async () => {
		const { treeId, id } = await build(['root', 'kid'], [{ parent: 'root', child: 'kid' }]);
		await t.db.run(sql`update individuals set privacy = 'private' where id = ${id('kid')}`);
		await t.db.run(sql`update individuals set privacy = 'public' where id = ${id('root')}`);
		const viewer = { isRestricted: true, cutoff: '1906-10-01', creatorId: null };
		const statement = sql`select i.given_name as name from individuals i where i.tree_id = ${treeId}${inSubtree('i', treeId, id('root'))}${andVisible('i', viewer)}`;
		const { sql: text, params } = dialect.sqlToQuery(statement);
		const rows = await t.d1
			.prepare(text)
			.bind(...params)
			.all<{ name: string }>();
		expect(rows.results.map((r) => r.name)).toEqual(['root']);
	});
});

describe('the plan', () => {
	it('walks descent by idx_parent_child_parent and partners by the union-partner indexes (the union side by the unique index that leads with union_id)', async () => {
		const treeId = crypto.randomUUID();
		await t.db.insert(trees).values({ id: treeId, name: 'Big' });
		await insertCorpus(t.db, treeId, { prefix: treeId.slice(0, 8), shouldNameThePeople: true });
		const root = await t.d1
			.prepare('select id from individuals where tree_id = ? limit 1')
			.bind(treeId)
			.first<{ id: string }>();
		const statement: SQL = sql`select i.id from individuals i where i.tree_id = ${treeId}${inSubtree('i', treeId, root!.id)}`;
		const { sql: text, params } = dialect.sqlToQuery(statement);
		const plan = await t.d1
			.prepare(`EXPLAIN QUERY PLAN ${text}`)
			.bind(...params)
			.all<{ detail: string }>();
		const details = plan.results.map((r) => r.detail);
		expect(details.some((d) => d.includes('idx_parent_child_parent'))).toBe(true);
		expect(details.some((d) => d.includes('idx_union_partner_person'))).toBe(true);
		expect(details.some((d) => d.includes('idx_uq_union_person'))).toBe(true);
		// The only table scans are the recursive CTE itself.
		expect(details.filter((d) => /^SCAN (?!line|l$|CONSTANT ROW|\(subquery)/.test(d))).toEqual([]);
	}, 120_000);

	it('binds the tree id and root id and nothing else', () => {
		const { params } = dialect.sqlToQuery(sql`select 1 where 1 = 1${inSubtree('i', 'T', 'R')}`);
		expect(params).toEqual(['R', 'T']);
	});
});
