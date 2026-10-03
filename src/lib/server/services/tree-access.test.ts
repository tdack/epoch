import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { UnauthorizedError } from '../domain/errors';
import { UserRepository } from '../repositories/user-repository';
import { addTestMember, createTestDatabase, createTestTree, createTestUser } from '../testing/d1';
import type { TestDatabase } from '../testing/d1';
import { requireMemberAction, requireTreeAction } from './tree-access';

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
	return {
		treeId,
		owner,
		viewer,
		stranger: await createTestUser(t.db),
		users: new UserRepository(t.db)
	};
}

describe('requireTreeAction', () => {
	it('answers the role when it allows the action', async () => {
		const s = await setup();
		await expect(
			requireTreeAction(s.users, s.treeId, s.owner.context, 'tree:delete')
		).resolves.toBe('owner');
		await expect(requireTreeAction(s.users, s.treeId, s.viewer.context, 'tree:view')).resolves.toBe(
			'viewer'
		);
	});

	it('refuses a role below the action, and a non-member, with the same words', async () => {
		const s = await setup();
		const refusal = "Forbidden: insufficient privileges for action 'tree:delete'";
		await expect(
			requireTreeAction(s.users, s.treeId, s.viewer.context, 'tree:delete')
		).rejects.toThrow(refusal);
		await expect(
			requireTreeAction(s.users, s.treeId, s.stranger.context, 'tree:delete')
		).rejects.toThrow(refusal);
	});
});

describe('requireMemberAction', () => {
	it('checks a requester known only by id, as the export workflow has', async () => {
		const s = await setup();
		await expect(
			requireMemberAction(s.users, s.treeId, s.owner.userId, 'tree:export')
		).resolves.toBe('owner');
		await expect(
			requireMemberAction(s.users, s.treeId, s.viewer.userId, 'tree:export')
		).rejects.toBeInstanceOf(UnauthorizedError);
		await expect(
			requireMemberAction(s.users, s.treeId, 'nobody', 'tree:export')
		).rejects.toBeInstanceOf(UnauthorizedError);
	});
});
