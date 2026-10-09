import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NotAdmittedError } from '../domain/errors';
import { UserRepository } from '../repositories/user-repository';
import { createTestDatabase, createTestTree, createTestUser } from '../testing/d1';
import type { TestDatabase } from '../testing/d1';
import { TreeService } from './tree-service';

let t: TestDatabase;
beforeAll(async () => {
	t = await createTestDatabase();
});
afterAll(async () => {
	await t.dispose();
});

describe('starting a tree (ADR-034)', () => {
	it('lets the install owner start one, and makes them its owner', async () => {
		const owner = await createTestUser(t.db, 'install-owner');
		const context = { ...owner.context, user: { ...owner.context.user, isInstallOwner: true } };
		const tree = await new TreeService(t.db).createTree('  Simpson family  ', null, context);
		expect(tree.name).toBe('Simpson family');
		expect((await new UserRepository(t.db).getMembership(tree.id, owner.userId))?.role).toBe(
			'owner'
		);
	});

	it('lets a member of any tree start one of their own', async () => {
		const member = await createTestUser(t.db, 'member');
		await createTestTree(t.db, member, 'viewer');
		await expect(
			new TreeService(t.db).createTree('Their own', null, member.context)
		).resolves.toMatchObject({ name: 'Their own' });
	});

	it('refuses anyone else with a typed error, before validating the name', async () => {
		const loner = await createTestUser(t.db, 'loner');
		await expect(new TreeService(t.db).createTree('', null, loner.context)).rejects.toBeInstanceOf(
			NotAdmittedError
		);
		await expect(
			new TreeService(t.db).createTree('Mine', null, loner.context)
		).rejects.toMatchObject({ code: 'NOT_ADMITTED', status: 403 });
	});
});
