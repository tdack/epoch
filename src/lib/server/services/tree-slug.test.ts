import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { trees } from '../db/schema';
import { TreeRepository } from '../repositories/tree-repository';
import { addTestMember, createTestDatabase, createTestTree, createTestUser } from '../testing/d1';
import { importGedcomToDb } from '../testing/gedcom';
import type { TestDatabase } from '../testing/d1';
import { GraphQueryService } from './graph-query-service';
import { TreeService } from './tree-service';

let t: TestDatabase;
beforeAll(async () => {
	t = await createTestDatabase();
});
afterAll(async () => {
	await t.dispose();
});

const service = () => new TreeService(t.db);
// Only a member of some tree may start one (ADR-034), so each maker first belongs to one.
async function maker() {
	const user = await createTestUser(t.db);
	await createTestTree(t.db, user);
	return user;
}
const slugOf = async (id: string) =>
	(await t.db.select({ slug: trees.slug }).from(trees).where(eq(trees.id, id)).get())?.slug;

describe('tree slugs (ADR-045)', () => {
	it('are made from the name on create, numbered when the name is taken', async () => {
		const user = await maker();
		const first = await service().createTree('The Slugworths', null, user.context);
		const second = await service().createTree('The  Slugworths!', null, user.context);
		expect(first.slug).toBe('the-slugworths');
		expect(second.slug).toBe('the-slugworths-2');
		const none = await service().createTree('山田家', null, user.context);
		expect(none.slug).toBeNull();
	});

	it('are given to a tree a GEDCOM import creates', async () => {
		const treeId = crypto.randomUUID();
		await importGedcomToDb(
			t.d1,
			treeId,
			'0 HEAD\n1 GEDC\n2 VERS 5.5.1\n0 TRLR\n',
			'Imported Gedslugs'
		);
		expect(await slugOf(treeId)).toBe('imported-gedslugs');
	});

	it('stay put on rename, and change only when asked', async () => {
		const user = await maker();
		const tree = await service().createTree('Renamers', null, user.context);
		const renamed = await service().updateTree(tree.id, 1, { name: 'New name' }, user.context);
		expect(renamed.slug).toBe('renamers');
		const moved = await service().updateTree(tree.id, 2, { slug: 'the-renamers' }, user.context);
		expect(moved.slug).toBe('the-renamers');
		const cleared = await service().updateTree(tree.id, 3, { slug: null }, user.context);
		expect(cleared.slug).toBeNull();
	});

	it('refuse another tree’s slug and a slug shaped like an id', async () => {
		const user = await maker();
		await service().createTree('Taken Slug', null, user.context);
		const other = await service().createTree('Other Slug', null, user.context);
		await expect(
			service().updateTree(other.id, 1, { slug: 'taken-slug' }, user.context)
		).rejects.toThrow('already uses');
		await expect(
			service().updateTree(other.id, 1, { slug: other.id }, user.context)
		).rejects.toThrow('lower-case');
	});

	it('are editable only by those who may rename the tree', async () => {
		const owner = await createTestUser(t.db);
		const treeId = await createTestTree(t.db, owner);
		const editor = await createTestUser(t.db);
		await addTestMember(t.db, treeId, editor, 'editor');
		await expect(
			service().updateTree(treeId, 1, { slug: 'editors-choice' }, editor.context)
		).rejects.toThrow('Forbidden');
	});

	it('resolve to the tree’s id, and leave an unknown segment as it is', async () => {
		const user = await maker();
		const tree = await service().createTree('Resolvable', null, user.context);
		expect(await service().resolveSegment('resolvable')).toBe(tree.id);
		expect(await service().resolveSegment(tree.id)).toBe(tree.id);
		expect(await service().resolveSegment('no-such-tree')).toBe('no-such-tree');
	});

	it('unlock nothing: a stranger is refused alike by slug, by id, and for a tree that does not exist', async () => {
		const owner = await maker();
		const tree = await service().createTree('Private Slugs', null, owner.context);
		const stranger = await createTestUser(t.db);
		const summaryVia = async (segment: string) =>
			new GraphQueryService(t.db)
				.summary(await service().resolveSegment(segment), stranger.context)
				.then(
					() => 'served',
					(cause: Error) => cause.constructor.name
				);
		const bySlug = await summaryVia('private-slugs');
		expect(bySlug).not.toBe('served');
		expect(await summaryVia(tree.id)).toBe(bySlug);
		expect(await summaryVia('no-such-slug')).toBe(bySlug);
	});

	it('appear in the tree list and the summary', async () => {
		const user = await maker();
		const tree = await service().createTree('Listed Slugs', null, user.context);
		const listed = (await new TreeRepository(t.db).listForUser(user.userId)).find(
			(row) => row.id === tree.id
		);
		expect(listed?.slug).toBe('listed-slugs');
		const summary = await new GraphQueryService(t.db).summary(tree.id, user.context);
		expect(summary.tree.slug).toBe('listed-slugs');
	});
});
