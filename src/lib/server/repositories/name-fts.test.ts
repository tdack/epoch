import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SQLiteSyncDialect } from 'drizzle-orm/sqlite-core';
import { trees } from '../db/schema';
import { ChangeLogService } from '../services/change-log-service';
import { NameService } from '../services/name-service';
import { PersonMergeService } from '../services/person-merge-service';
import { PersonService } from '../services/person-service';
import { insertCorpus } from '../testing/corpus';
import {
	createTestDatabase,
	createTestTree,
	createTestUser,
	type TestActor,
	type TestDatabase
} from '../testing/d1';
import { SearchRepository, type SearchFilters } from './search-repository';

let t: TestDatabase;
beforeAll(async () => {
	t = await createTestDatabase();
});
afterAll(async () => {
	await t.dispose();
});

/** The name text the index holds, as the migration and the triggers build it: no lower-casing. */
const PERSON_OWN_TEXT = `rtrim(coalesce(i.given_name || ' ', '') || coalesce(i.surname, ''))`;
const NAME_TEXT = `rtrim(coalesce(n.name_prefix || ' ', '') || coalesce(n.given_name || ' ', '') || coalesce(n.nickname || ' ', '') || coalesce(n.surname_prefix || ' ', '') || coalesce(n.surname || ' ', '') || coalesce(n.name_suffix, ''))`;

/** What the index must hold, computed from the base tables alone. */
async function rebuiltFromBaseTables(): Promise<string[]> {
	const rows = (
		await t.d1
			.prepare(
				`select ${PERSON_OWN_TEXT} as name, i.tree_id as tree, i.id as person, '' as name_id from individuals i
				union all
				select ${NAME_TEXT} as name, i.tree_id, n.person_id, n.id from person_names n join individuals i on i.id = n.person_id`
			)
			.all<{ name: string; tree: string; person: string; name_id: string }>()
	).results;
	return rows.map((r) => [r.name, r.tree, r.person, r.name_id].join('|')).sort();
}

/**
 * The index equals a rebuild from the base tables, and each FTS row is keyed by its
 * `name_fts_key` row (the rowid the triggers find it by).
 */
async function expectIndexMatchesBaseTables(): Promise<void> {
	const actual = (
		await t.d1
			.prepare(
				`select name, tree_id as tree, person_id as person, coalesce(name_id, '') as name_id from name_fts`
			)
			.all<{ name: string; tree: string; person: string; name_id: string }>()
	).results;
	expect(actual.map((r) => [r.name, r.tree, r.person, r.name_id].join('|')).sort()).toEqual(
		await rebuiltFromBaseTables()
	);
	const keyed = await t.d1
		.prepare(
			`select count(*) c from name_fts f join name_fts_key k on k.id = f.rowid
			where k.person_id = f.person_id and coalesce(k.name_id, '') = coalesce(f.name_id, '')`
		)
		.first<{ c: number }>();
	const keys = await t.d1.prepare('select count(*) c from name_fts_key').first<{ c: number }>();
	expect(keyed!.c).toBe(actual.length);
	expect(keys!.c).toBe(actual.length);
}

const dialect = new SQLiteSyncDialect();
const EVERYONE = { isRestricted: false, cutoff: '1906-10-01', creatorId: null };
const filters = (words: string[]): SearchFilters => ({
	words,
	place: '',
	from: '',
	to: '',
	limit: 50,
	offset: 0
});

async function namesFound(treeId: string, words: string[]): Promise<string[]> {
	const repo = new SearchRepository(t.db);
	const { hits } = await repo.find(treeId, filters(words), EVERYONE);
	return hits.map((h) => h.personId);
}

async function personNamed(treeId: string, given: string, surname: string, actor: TestActor) {
	return (
		await new PersonService(t.db).create(treeId, { givenName: given, surname }, actor.context)
	).individual;
}

describe('folding in the name index', () => {
	it('finds "Müller" for "müller" and "Muller", and not for "mueller" (folding is not transliteration)', async () => {
		const actor = await createTestUser(t.db, 'fold');
		const treeId = await createTestTree(t.db, actor);
		const hans = await personNamed(treeId, 'Hans', 'Müller', actor);
		await personNamed(treeId, 'Ruth', 'Smith', actor);

		expect(await namesFound(treeId, ['müller'])).toEqual([hans.id]);
		expect(await namesFound(treeId, ['muller'])).toEqual([hans.id]);
		expect(await namesFound(treeId, ['mueller'])).toEqual([]);
	});

	it('requires every word of three or more letters to be in the same name, folded', async () => {
		const actor = await createTestUser(t.db, 'words');
		const treeId = await createTestTree(t.db, actor);
		const zoe = await personNamed(treeId, 'Zoë', 'Müller', actor);
		await personNamed(treeId, 'Zoë', 'Brown', actor);

		expect(await namesFound(treeId, ['zoe', 'muller'])).toEqual([zoe.id]);
		expect(await namesFound(treeId, ['zoe', 'brown', 'muller'])).toEqual([]);
	});

	it('keeps two-letter words on the LIKE path, with the words as typed', async () => {
		const actor = await createTestUser(t.db, 'short');
		const treeId = await createTestTree(t.db, actor);
		const ann = await personNamed(treeId, 'Ann', 'Ash', actor);
		await personNamed(treeId, 'Bob', 'Ash', actor);

		expect(await namesFound(treeId, ['an'])).toEqual([ann.id]);
		expect(await namesFound(treeId, ['ann', 'an'])).toEqual([ann.id]);
	});
});

describe('the index follows every write path', () => {
	it('stays equal to a rebuild from the base tables through create, rename, names, merge, undo, delete and tree move', async () => {
		const actor = await createTestUser(t.db, 'writes');
		const treeId = await createTestTree(t.db, actor);
		const other = await createTestTree(t.db, actor);
		const people = new PersonService(t.db);
		const names = new NameService(t.db);
		const ctx = actor.context;

		const ann = await personNamed(treeId, 'Ann', 'Ash', actor);
		const annAgain = await personNamed(treeId, 'Anne', 'Ashe', actor);
		await expectIndexMatchesBaseTables();

		// Rename: the own row changes, the stored names do not.
		await people.update(treeId, ann.id, 1, { givenName: 'Annie', surname: 'Ashton' }, ctx);
		await expectIndexMatchesBaseTables();

		// Add, rename and remove a stored name.
		const added = await names.create(
			treeId,
			ann.id,
			{ type: 'married', givenName: 'Ann', surname: 'Smithson' },
			false,
			ctx
		);
		await expectIndexMatchesBaseTables();
		await names.update(treeId, added.nameId, { surname: 'Smythe' }, 1, ctx);
		await expectIndexMatchesBaseTables();
		await names.remove(treeId, added.nameId, undefined, ctx);
		await expectIndexMatchesBaseTables();

		// Merge, then undo it: the merged person's names come back, and the index with them.
		await new PersonMergeService(t.db).merge(
			treeId,
			{ survivorId: ann.id, mergedId: annAgain.id },
			ctx
		);
		await expectIndexMatchesBaseTables();
		await new ChangeLogService(t.db).undoLast(treeId, ctx);
		await expectIndexMatchesBaseTables();

		// Remove a person outright.
		await people.remove(treeId, annAgain.id, ctx);
		await expectIndexMatchesBaseTables();

		// A tree move reaches the person's own row and their names.
		const moved = await personNamed(treeId, 'Moved', 'Person', actor);
		await names.create(
			treeId,
			moved.id,
			{ type: 'aka', givenName: 'Mo', surname: 'Pe' },
			false,
			ctx
		);
		await t.d1
			.prepare('update individuals set tree_id = ? where id = ?')
			.bind(other, moved.id)
			.run();
		await expectIndexMatchesBaseTables();

		// A replace-mode import deletes the tree's people in one statement, then writes new ones.
		await t.d1.prepare('delete from individuals where tree_id = ?').bind(treeId).run();
		await expectIndexMatchesBaseTables();
		await personNamed(treeId, 'Fresh', 'Start', actor);
		await expectIndexMatchesBaseTables();
		// Each check rebuilds the index from every row, so this takes longer than a unit test's default.
	}, 120_000);

	it('stays equal after a bulk insert and after a tree is deleted, and the search of another tree is unaffected', async () => {
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
		await expectIndexMatchesBaseTables();

		const bigBefore = (await t.d1
			.prepare('select count(*) c from name_fts where tree_id = ?')
			.bind(big)
			.first<{ c: number }>())!.c;
		await t.d1.prepare('delete from trees where id = ?').bind(small).run();
		await expectIndexMatchesBaseTables();
		const bigAfter = (await t.d1
			.prepare('select count(*) c from name_fts where tree_id = ?')
			.bind(big)
			.first<{ c: number }>())!.c;
		expect(bigAfter).toBe(bigBefore);
	}, 240_000);
});

describe('the two-tree witness, on the index', () => {
	it("answers a search of the small tree from the small tree's own rows", async () => {
		const big = crypto.randomUUID();
		const small = crypto.randomUUID();
		await t.db.insert(trees).values({ id: big, name: 'Witness big' });
		await t.db.insert(trees).values({ id: small, name: 'Witness small' });
		await insertCorpus(t.db, big, { prefix: big.slice(0, 8), shouldNameThePeople: true, seed: 3 });
		await insertCorpus(t.db, small, {
			prefix: small.slice(0, 8),
			shouldNameThePeople: true,
			seed: 7,
			lineages: 2,
			generations: 7
		});
		const rowsIn = async (tree: string) =>
			(await t.d1
				.prepare('select count(*) c from name_fts where tree_id = ?')
				.bind(tree)
				.first<{ c: number }>())!.c;
		const smallRows = await rowsIn(small);
		const bigRows = await rowsIn(big);
		expect(bigRows).toBeGreaterThan(smallRows * 3);

		const repo = new SearchRepository(t.db);
		const { sql, params } = dialect.sqlToQuery(repo.findSql(small, filters(['ann']), EVERYONE));
		const run = await t.d1
			.prepare(sql)
			.bind(...params)
			.run();
		expect(run.meta.rows_read).toBeLessThanOrEqual(smallRows);
		expect(run.meta.rows_read).toBeLessThan(bigRows / 4);
	}, 240_000);
});
