import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TreeRepository } from '../repositories/tree-repository';
import { addTestMember, createTestDatabase, createTestTree, createTestUser } from '../testing/d1';
import type { TestDatabase } from '../testing/d1';
import { TreeService } from './tree-service';

type Actor = Awaited<ReturnType<typeof createTestUser>>;
let t: TestDatabase;
beforeAll(async () => {
	t = await createTestDatabase();
});
afterAll(async () => {
	await t.dispose();
});

async function setup() {
	const owner = await createTestUser(t.db);
	const treeId = await createTestTree(t.db, owner);
	const viewer = await createTestUser(t.db);
	await addTestMember(t.db, treeId, viewer, 'viewer');
	return { treeId, owner, viewer, service: new TreeService(t.db), repo: new TreeRepository(t.db) };
}

const treeFor = async (s: Awaited<ReturnType<typeof setup>>, user: Actor) =>
	(await s.repo.listForUser(user.context.user.id)).find((tree) => tree.id === s.treeId)!;

describe('view mode settings', () => {
	it('start unset, so a tree opens flat until someone chooses', async () => {
		const s = await setup();
		const tree = await treeFor(s, s.viewer);
		expect(tree.viewMode).toBeNull();
	});

	it('lets any member choose their own view, and clear it', async () => {
		const s = await setup();
		await s.service.setViewMode(s.treeId, 'orrery', s.viewer.context);
		expect((await treeFor(s, s.viewer)).viewMode).toBe('orrery');
		// It is theirs alone.
		expect((await treeFor(s, s.owner)).viewMode).toBeNull();
		await s.service.setViewMode(s.treeId, null, s.viewer.context);
		expect((await treeFor(s, s.viewer)).viewMode).toBeNull();
	});

	it('leaves the tree and member versions alone, since neither is a record edit', async () => {
		const s = await setup();
		const before = await treeFor(s, s.owner);
		await s.service.setViewMode(s.treeId, 'rings', s.owner.context);
		const after = await treeFor(s, s.owner);
		expect(after.version).toBe(before.version);
		expect(after.updatedAt).toEqual(before.updatedAt);
		const member = await t.d1
			.prepare('SELECT version FROM tree_memberships WHERE tree_id = ? AND user_id = ?')
			.bind(s.treeId, s.owner.context.user.id)
			.first<{ version: number }>();
		expect(member?.version).toBe(1);
	});

	it('does not let a non-member write', async () => {
		const s = await setup();
		const stranger = await createTestUser(t.db);
		await expect(s.service.setViewMode(s.treeId, 'orrery', stranger.context)).rejects.toThrow(
			'Forbidden'
		);
	});
});
