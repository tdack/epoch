import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TreeRepository } from '../repositories/tree-repository';
import { treeHostConfig } from '../http/tree-host';
import { addTestMember, createTestDatabase, createTestTree, createTestUser } from '../testing/d1';
import type { TestDatabase } from '../testing/d1';
import { TreeService } from './tree-service';

let t: TestDatabase;
beforeAll(async () => {
	t = await createTestDatabase();
});
afterAll(async () => {
	await t.dispose();
});

const service = () => new TreeService(t.db);
const subdomains = treeHostConfig({
	EPOCH_TREE_HOST_ZONE: 'example.com',
	EPOCH_RESERVED_SUBDOMAINS: 'demo'
});
async function ownedTree(name: string) {
	const user = await createTestUser(t.db);
	await createTestTree(t.db, user);
	const tree = await service().createTree(name, null, user.context);
	return { user, tree };
}

describe('a tree on its own subdomain', () => {
	it('is off until turned on, and then found by its slug', async () => {
		const { user, tree } = await ownedTree('Subdomain Dacks');
		const repo = new TreeRepository(t.db);
		expect(await repo.findOnSubdomain('subdomain-dacks')).toBeNull();
		const on = await service().updateTree(
			tree.id,
			1,
			{ isOnSubdomain: true },
			user.context,
			subdomains
		);
		expect(on.isOnSubdomain).toBe(true);
		expect(await repo.findOnSubdomain('subdomain-dacks')).toEqual({
			id: tree.id,
			slug: 'subdomain-dacks'
		});
	});

	it('answers the same for a label that names no tree and one whose subdomain is off', async () => {
		await ownedTree('Not Served');
		const repo = new TreeRepository(t.db);
		expect(await repo.findOnSubdomain('not-served')).toBeNull();
		expect(await repo.findOnSubdomain('no-such-tree')).toBeNull();
	});

	it('moves with the slug, and goes when the slug is given up', async () => {
		const { user, tree } = await ownedTree('Movers');
		const repo = new TreeRepository(t.db);
		await service().updateTree(tree.id, 1, { isOnSubdomain: true }, user.context, subdomains);
		await service().updateTree(tree.id, 2, { slug: 'the-movers' }, user.context, subdomains);
		expect(await repo.findOnSubdomain('movers')).toBeNull();
		expect(await repo.findOnSubdomain('the-movers')).not.toBeNull();
		const cleared = await service().updateTree(tree.id, 3, { slug: null }, user.context);
		expect(cleared.isOnSubdomain).toBe(false);
	});

	it('is refused for a reserved label, and where the install serves no subdomains', async () => {
		const { user, tree } = await ownedTree('Demo');
		await expect(
			service().updateTree(tree.id, 1, { isOnSubdomain: true }, user.context, subdomains)
		).rejects.toThrow('reserved');
		await expect(
			service().updateTree(tree.id, 1, { isOnSubdomain: true }, user.context, null)
		).rejects.toThrow('does not serve trees on subdomains');
	});

	it('refuses a slug change onto a reserved label while the subdomain is on', async () => {
		const { user, tree } = await ownedTree('Soon Demo');
		await service().updateTree(tree.id, 1, { isOnSubdomain: true }, user.context, subdomains);
		await expect(
			service().updateTree(tree.id, 2, { slug: 'demo' }, user.context, subdomains)
		).rejects.toThrow('reserved');
	});

	it('still renames when the install has since dropped the setting', async () => {
		const { user, tree } = await ownedTree('Kept On');
		await service().updateTree(tree.id, 1, { isOnSubdomain: true }, user.context, subdomains);
		const renamed = await service().updateTree(tree.id, 2, { name: 'Kept On Still' }, user.context);
		expect(renamed.isOnSubdomain).toBe(true);
	});

	it('can be changed only by those who may rename the tree', async () => {
		const { tree } = await ownedTree('Editors Only');
		const editor = await createTestUser(t.db);
		await addTestMember(t.db, tree.id, editor, 'editor');
		await expect(
			service().updateTree(tree.id, 1, { isOnSubdomain: true }, editor.context, subdomains)
		).rejects.toThrow();
	});
});
