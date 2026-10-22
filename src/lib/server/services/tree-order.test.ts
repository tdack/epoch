/** The install-wide tree order (backlog: drag to reorder): who sets it, and where it shows. */

import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { trees } from '../db/schema';
import type { AuthenticatedContext } from '../domain/identity';
import { TreeRepository } from '../repositories/tree-repository';
import {
	createTestDatabase,
	createTestTree,
	createTestUser,
	type TestActor,
	type TestDatabase
} from '../testing/d1';
import { PublicTreeService } from './public-tree-service';
import { TreeService } from './tree-service';

let t: TestDatabase;
let member: TestActor;
let ownerCtx: AuthenticatedContext;
let ids: string[];

const service = () => new PublicTreeService(t.db);
const listed = async () => (await service().listAll(ownerCtx)).map((r) => r.id);

beforeAll(async () => {
	t = await createTestDatabase();
	const owner = await createTestUser(t.db, 'install-owner');
	ownerCtx = { ...owner.context, user: { ...owner.context.user, isInstallOwner: true } };
	member = await createTestUser(t.db, 'member');
	ids = [await createTestTree(t.db, member), await createTestTree(t.db, member)];
	ids.push(await createTestTree(t.db, member));
}, 60_000);
afterAll(async () => {
	await t.dispose();
});

describe('reordering trees', () => {
	it('is the install owner’s alone', async () => {
		await expect(service().reorder(ids, member.context)).rejects.toMatchObject({ status: 403 });
	});

	it('refuses a missing, extra or repeated tree and changes nothing', async () => {
		const before = await listed();
		await expect(service().reorder(ids.slice(1), ownerCtx)).rejects.toMatchObject({
			name: 'ConcurrencyConflictError'
		});
		await expect(service().reorder([...ids, 'nope'], ownerCtx)).rejects.toMatchObject({
			name: 'ConcurrencyConflictError'
		});
		await expect(service().reorder([ids[0]!, ids[0]!, ids[1]!], ownerCtx)).rejects.toMatchObject({
			code: 'VALIDATION_ERROR'
		});
		expect(await listed()).toEqual(before);
	});

	it('persists, shows in both lists, and leaves version and updatedAt alone', async () => {
		const row = async () => (await t.db.select().from(trees).where(eq(trees.id, ids[0]!)))[0]!;
		const before = await row();
		const order = [ids[2]!, ids[0]!, ids[1]!];
		await service().reorder(order, ownerCtx);

		expect(await listed()).toEqual(order);
		const mine = await new TreeRepository(t.db).listForUser(member.userId);
		expect(mine.map((r) => r.id)).toEqual(order);
		const after = await row();
		expect(after.version).toBe(before.version);
		expect(after.updatedAt).toEqual(before.updatedAt);
	});

	it('puts a new tree last', async () => {
		const created = await new TreeService(t.db).createTree('Newest', null, member.context);
		expect((await listed()).at(-1)).toBe(created.id);
	});
});
