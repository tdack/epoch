/**
 * Sub-trees over a real database: who may manage and who may see them, the rules a write enforces,
 * undo of a delete, the repoint when the root is merged away, and the cascade with the tree.
 */

import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { individuals, subtrees, trees } from '../db/schema';
import {
	ConcurrencyConflictError,
	NotFoundError,
	UnauthorizedError,
	ValidationError
} from '../domain/errors';
import {
	addTestMember,
	createTestDatabase,
	createTestTree,
	createTestUser,
	type TestActor,
	type TestDatabase
} from '../testing/d1';
import { ChangeLogService } from './change-log-service';
import { GraphQueryService } from './graph-query-service';
import { PersonMergeService } from './person-merge-service';
import { SubtreeService } from './subtree-service';
import { TreeService } from './tree-service';
import { FakeMediaBucket } from '../testing/fake-bucket';
import type { R2Bucket } from '@cloudflare/workers-types';

let t: TestDatabase;
let owner: TestActor;
let manager: TestActor;
let editor: TestActor;
let viewer: TestActor;
let treeId: string;
let service: SubtreeService;

const person = (id: string, o: Partial<typeof individuals.$inferInsert> = {}) =>
	t.db.insert(individuals).values({ id, treeId, givenName: id, privacy: 'public', ...o });

beforeAll(async () => {
	t = await createTestDatabase();
	owner = await createTestUser(t.db, 'owner');
	manager = await createTestUser(t.db, 'manager');
	editor = await createTestUser(t.db, 'editor');
	viewer = await createTestUser(t.db, 'viewer');
	treeId = await createTestTree(t.db, owner);
	await addTestMember(t.db, treeId, manager, 'manager');
	await addTestMember(t.db, treeId, editor, 'editor');
	await addTestMember(t.db, treeId, viewer, 'viewer');
	service = new SubtreeService(t.db);
	await person('root-a');
	await person('root-b');
	await person('hidden-root', { privacy: 'private' });
}, 60_000);
afterAll(async () => {
	await t.dispose();
});

const make = (slug: string, rootPersonId = 'root-a', name = `Line ${slug}`) =>
	service.create(treeId, { name, slug, rootPersonId }, manager.context);

describe('managing sub-trees', () => {
	it('is for managers and above', async () => {
		await expect(
			service.create(treeId, { name: 'X', slug: 'x', rootPersonId: 'root-a' }, editor.context)
		).rejects.toBeInstanceOf(UnauthorizedError);
		await expect(
			service.create(treeId, { name: 'X', slug: 'x', rootPersonId: 'root-a' }, viewer.context)
		).rejects.toBeInstanceOf(UnauthorizedError);
		expect((await make('by-manager')).subtreeId).toBeTruthy();
		await expect(
			service.create(treeId, { name: 'Y', slug: 'by-owner', rootPersonId: 'root-a' }, owner.context)
		).resolves.toBeTruthy();
	});

	it('refuses a missing root, a bad or taken slug, and a stale version', async () => {
		await expect(make('no-root', 'nobody')).rejects.toBeInstanceOf(NotFoundError);
		await expect(make('Not A Slug')).rejects.toThrow(/address/);
		await make('taken');
		await expect(make('taken')).rejects.toThrow(/already uses/);
		const { subtreeId } = await make('versioned');
		await service.update(treeId, subtreeId, { name: 'Renamed', version: 1 }, manager.context);
		await expect(
			service.update(treeId, subtreeId, { name: 'Again', version: 1 }, manager.context)
		).rejects.toBeInstanceOf(ConcurrencyConflictError);
		const got = await service.get(treeId, 'versioned', manager.context);
		expect(got).toMatchObject({ name: 'Renamed', version: 2, isRootMissing: false });
	});

	it('lists in position order, and a new one goes last', async () => {
		const own = await createTestTree(t.db, owner);
		const s = new SubtreeService(t.db);
		await t.db.insert(individuals).values({ id: 'p-own', treeId: own, privacy: 'public' });
		const mk = (slug: string) =>
			s.create(own, { name: slug, slug, rootPersonId: 'p-own' }, owner.context);
		await mk('a');
		await mk('b');
		await mk('c');
		expect((await s.list(own, owner.context)).map((x) => x.slug)).toEqual(['a', 'b', 'c']);
	});

	describe('reordering', () => {
		async function three() {
			const own = await createTestTree(t.db, owner);
			await addTestMember(t.db, own, editor, 'editor');
			await t.db.insert(individuals).values({ id: `p-${own}`, treeId: own, privacy: 'public' });
			const s = new SubtreeService(t.db);
			for (const slug of ['a', 'b', 'c'])
				await s.create(own, { name: slug, slug, rootPersonId: `p-${own}` }, owner.context);
			return { own, s, list: () => s.list(own, owner.context) };
		}
		const order = (
			list: { id: string; version: number }[],
			slugs: string[],
			all: { slug: string }[]
		) =>
			slugs.map((slug) => {
				const i = all.findIndex((x) => x.slug === slug);
				return { id: list[i]!.id, version: list[i]!.version };
			});

		it('writes the positions as one change, and one undo restores the old order', async () => {
			const { own, s, list } = await three();
			const before = await list();
			const { change } = await s.reorder(
				own,
				order(before, ['c', 'a', 'b'], before),
				owner.context
			);
			expect(change?.isUndoable).toBe(true);
			expect((await list()).map((x) => x.slug)).toEqual(['c', 'a', 'b']);
			await new ChangeLogService(t.db).undoLast(own, owner.context);
			expect((await list()).map((x) => x.slug)).toEqual(['a', 'b', 'c']);
		});

		it('is refused on a stale version, a changed set, a duplicate, or without the role', async () => {
			const { own, s, list } = await three();
			const all = await list();
			const good = order(all, ['b', 'a', 'c'], all);
			await expect(
				s.reorder(own, [{ ...good[0]!, version: 99 }, ...good.slice(1)], owner.context)
			).rejects.toBeInstanceOf(ConcurrencyConflictError);
			await expect(s.reorder(own, good.slice(1), owner.context)).rejects.toBeInstanceOf(
				ConcurrencyConflictError
			);
			await expect(
				s.reorder(own, [good[0]!, good[0]!, good[1]!], owner.context)
			).rejects.toBeInstanceOf(ValidationError);
			await expect(s.reorder(own, good, editor.context)).rejects.toBeInstanceOf(UnauthorizedError);
			expect((await list()).map((x) => x.slug)).toEqual(['a', 'b', 'c']);
		});
	});

	it('gets by id or slug, and a delete is undoable', async () => {
		const { subtreeId } = await make('to-delete');
		expect((await service.get(treeId, subtreeId, viewer.context)).slug).toBe('to-delete');
		await service.delete(treeId, subtreeId, undefined, manager.context);
		await expect(service.get(treeId, 'to-delete', manager.context)).rejects.toBeInstanceOf(
			NotFoundError
		);
		await new ChangeLogService(t.db).undoLast(treeId, manager.context);
		expect((await service.get(treeId, 'to-delete', manager.context)).id).toBe(subtreeId);
	});
});

describe('who sees which sub-tree', () => {
	it('hides one whose root the viewer may not see, from the list, by id and by slug, and the summary', async () => {
		const { subtreeId } = await make('secret', 'hidden-root');
		const names = async (who: TestActor) =>
			(await service.list(treeId, who.context)).map((s) => s.slug);
		expect(await names(manager)).toContain('secret');
		expect(await names(editor)).toContain('secret');
		expect(await names(viewer)).not.toContain('secret');
		await expect(service.get(treeId, subtreeId, viewer.context)).rejects.toBeInstanceOf(
			NotFoundError
		);
		await expect(service.get(treeId, 'secret', viewer.context)).rejects.toBeInstanceOf(
			NotFoundError
		);
		const summary = new GraphQueryService(t.db);
		expect(
			(await summary.summary(treeId, viewer.context)).subtrees.map((s) => s.slug)
		).not.toContain('secret');
		expect((await summary.summary(treeId, manager.context)).subtrees.map((s) => s.slug)).toContain(
			'secret'
		);
	});

	it('summarises as id, slug, name and root, in position order', async () => {
		const own = await createTestTree(t.db, owner);
		await t.db.insert(individuals).values({ id: 'p-sum', treeId: own, privacy: 'public' });
		const s = new SubtreeService(t.db);
		const { subtreeId } = await s.create(
			own,
			{ name: 'Sum line', slug: 'sum-line', rootPersonId: 'p-sum' },
			owner.context
		);
		expect((await new GraphQueryService(t.db).summary(own, owner.context)).subtrees).toEqual([
			{ id: subtreeId, slug: 'sum-line', name: 'Sum line', rootPersonId: 'p-sum' }
		]);
	});
});

describe('the root person', () => {
	it('reports a missing root to managers only, and works again when an undo brings the person back', async () => {
		const own = await createTestTree(t.db, owner);
		await addTestMember(t.db, own, viewer, 'viewer');
		await t.db.insert(individuals).values({ id: 'p-gone', treeId: own, privacy: 'public' });
		const s = new SubtreeService(t.db);
		await s.create(own, { name: 'Gone', slug: 'gone', rootPersonId: 'p-gone' }, owner.context);
		// Remove the person as a delete does: no cascade reaches the sub-tree.
		await t.db.delete(individuals).where(eq(individuals.id, 'p-gone'));
		expect(await s.list(own, owner.context)).toMatchObject([{ slug: 'gone', isRootMissing: true }]);
		expect(await s.list(own, viewer.context)).toEqual([]);
		expect((await new GraphQueryService(t.db).summary(own, owner.context)).subtrees).toEqual([]);
		await t.db.insert(individuals).values({ id: 'p-gone', treeId: own, privacy: 'public' });
		expect(await s.list(own, owner.context)).toMatchObject([
			{ slug: 'gone', isRootMissing: false }
		]);
	});

	it('is repointed to the survivor in the merge, and back by its undo', async () => {
		const own = await createTestTree(t.db, owner);
		for (const id of ['keep', 'fold'])
			await t.db
				.insert(individuals)
				.values({ id, treeId: own, givenName: 'Ann', privacy: 'public', sex: 'F' });
		const s = new SubtreeService(t.db);
		const { subtreeId } = await s.create(
			own,
			{ name: 'Folded', slug: 'folded', rootPersonId: 'fold' },
			owner.context
		);
		await new PersonMergeService(t.db).merge(
			own,
			{ survivorId: 'keep', mergedId: 'fold' },
			owner.context
		);
		expect(await s.get(own, subtreeId, owner.context)).toMatchObject({
			rootPersonId: 'keep',
			isRootMissing: false,
			version: 2
		});
		await new ChangeLogService(t.db).undoLast(own, owner.context);
		expect((await s.get(own, subtreeId, owner.context)).rootPersonId).toBe('fold');
	});
});

describe('deleting the tree', () => {
	it('takes its sub-trees with it', async () => {
		const own = await createTestTree(t.db, owner);
		await t.db.insert(individuals).values({ id: 'p-del', treeId: own, privacy: 'public' });
		await new SubtreeService(t.db).create(
			own,
			{ name: 'D', slug: 'd', rootPersonId: 'p-del' },
			owner.context
		);
		await new TreeService(t.db).deleteTree(
			own,
			owner.context,
			new FakeMediaBucket() as unknown as R2Bucket
		);
		expect(await t.db.select().from(subtrees).where(eq(subtrees.treeId, own))).toEqual([]);
		expect(await t.db.select().from(trees).where(eq(trees.id, own))).toEqual([]);
	});
});
