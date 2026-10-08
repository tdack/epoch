import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ConcurrencyConflictError, ValidationError } from '../domain/errors';
import { TreeRepository } from '../repositories/tree-repository';
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

async function setup() {
	const owner = await createTestUser(t.db);
	const treeId = await createTestTree(t.db, owner);
	const manager = await createTestUser(t.db);
	await addTestMember(t.db, treeId, manager, 'manager');
	const editor = await createTestUser(t.db);
	await addTestMember(t.db, treeId, editor, 'editor');
	const repo = new TreeRepository(t.db);
	const version = async () => (await repo.findById(treeId))!.version;
	return { treeId, owner, manager, editor, service: new TreeService(t.db), repo, version };
}

describe('renaming a tree', () => {
	it('lets a manager rename it, trimmed, and bumps the version', async () => {
		const s = await setup();
		const before = await s.version();
		const renamed = await s.service.updateTree(
			s.treeId,
			before,
			{ name: '  Simpson family  ' },
			s.manager.context
		);
		expect(renamed.name).toBe('Simpson family');
		expect((await s.repo.findById(s.treeId))!.name).toBe('Simpson family');
		expect(await s.version()).toBe(before + 1);
	});

	it('refuses an editor', async () => {
		const s = await setup();
		await expect(
			s.service.updateTree(s.treeId, await s.version(), { name: 'Mine' }, s.editor.context)
		).rejects.toThrow('Forbidden');
	});

	it('refuses a blank name', async () => {
		const s = await setup();
		await expect(
			s.service.updateTree(s.treeId, await s.version(), { name: '   ' }, s.owner.context)
		).rejects.toBeInstanceOf(ValidationError);
	});

	it('refuses a stale version and keeps the newer name', async () => {
		const s = await setup();
		const seen = await s.version();
		await s.service.updateTree(s.treeId, seen, { name: 'First' }, s.owner.context);
		await expect(
			s.service.updateTree(s.treeId, seen, { name: 'Second' }, s.manager.context)
		).rejects.toBeInstanceOf(ConcurrencyConflictError);
		expect((await s.repo.findById(s.treeId))!.name).toBe('First');
	});
});
