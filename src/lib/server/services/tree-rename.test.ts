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
			{ name: '  Doe family  ' },
			s.manager.context
		);
		expect(renamed.name).toBe('Doe family');
		expect((await s.repo.findById(s.treeId))!.name).toBe('Doe family');
		expect(await s.version()).toBe(before + 1);
	});

	it('saves the date format, defaults it, and refuses an editor changing it', async () => {
		const s = await setup();
		expect((await s.repo.findById(s.treeId))!.dateFormat).toBe('day_month_year');
		const before = await s.version();
		await s.service.updateTree(
			s.treeId,
			before,
			{ dateFormat: 'month_day_year' },
			s.manager.context
		);
		const after = (await s.repo.findById(s.treeId))!;
		expect(after.dateFormat).toBe('month_day_year');
		expect(after.version).toBe(before + 1);
		await expect(
			s.service.updateTree(s.treeId, after.version, { dateFormat: 'short' }, s.editor.context)
		).rejects.toThrow('Forbidden');
	});

	it('saves the GEDCOM submitter, clears it, and leaves it alone when a save omits it', async () => {
		const s = await setup();
		expect((await s.repo.findById(s.treeId))!.submitter).toEqual({
			name: null,
			email: null,
			www: null
		});
		await s.service.updateTree(
			s.treeId,
			await s.version(),
			{
				submitter: { name: ' Ada Smith ', email: 'ada@example.com', www: 'https://example.com/ada' }
			},
			s.manager.context
		);
		const expected = {
			name: 'Ada Smith',
			email: 'ada@example.com',
			www: 'https://example.com/ada'
		};
		expect(await s.service.getSubmitter(s.treeId, s.manager.context)).toEqual(expected);
		await s.service.updateTree(s.treeId, await s.version(), { name: 'Other' }, s.manager.context);
		expect((await s.repo.findById(s.treeId))!.submitter).toEqual(expected);
		await s.service.updateTree(
			s.treeId,
			await s.version(),
			{ submitter: { name: '', email: '  ', www: null } },
			s.manager.context
		);
		expect((await s.repo.findById(s.treeId))!.submitter).toEqual({
			name: null,
			email: null,
			www: null
		});
	});

	it('refuses a submitter with an address and no name, or a bad email or web address', async () => {
		const s = await setup();
		for (const submitter of [
			{ name: null, email: 'ada@example.com', www: null },
			{ name: 'Ada', email: 'not an email', www: null },
			{ name: 'Ada', email: null, www: 'ftp://example.com' }
		]) {
			await expect(
				s.service.updateTree(s.treeId, await s.version(), { submitter }, s.manager.context)
			).rejects.toBeInstanceOf(ValidationError);
		}
	});

	it('shows the submitter and lets it be changed only to a manager or above', async () => {
		const s = await setup();
		await expect(s.service.getSubmitter(s.treeId, s.editor.context)).rejects.toThrow('Forbidden');
		await expect(
			s.service.updateTree(
				s.treeId,
				await s.version(),
				{ submitter: { name: 'Ada', email: null, www: null } },
				s.editor.context
			)
		).rejects.toThrow('Forbidden');
		expect((await s.service.getSubmitter(s.treeId, s.owner.context)).name).toBeNull();
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
