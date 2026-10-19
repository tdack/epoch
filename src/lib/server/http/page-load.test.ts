import { redirect, type ServerLoadEvent } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { trees } from '../db/schema';
import { PUBLIC_VISITOR, type UserIdentity } from '../domain/identity';
import { NotFoundError } from '../domain/errors';
import { PublicTreeService } from '../services/public-tree-service';
import {
	addTestMember,
	createTestDatabase,
	createTestTree,
	createTestUser,
	type TestDatabase
} from '../testing/d1';
import { serverLoad, treeServerLoad } from './page-load';
import { DATA_KEY } from '../../shared/data-key';

let t: TestDatabase;
let publicId: string;
let privateId: string;
let member: UserIdentity;

function eventOf(
	user: UserIdentity | null,
	params: Record<string, string> = {},
	hasDb = true
): ServerLoadEvent {
	return {
		locals: { user, correlationId: 'c1' },
		platform: { env: hasDb ? { DB: t.d1 } : {} },
		params,
		depends: vi.fn()
	} as unknown as ServerLoadEvent;
}

/** What the load threw: SvelteKit's `error()` throws an object with a status and a body. */
async function failure(promise: Promise<unknown>) {
	try {
		await promise;
	} catch (cause) {
		const { status, body } = cause as { status: number; body?: { message: string } };
		return { status, message: body?.message };
	}
	throw new Error('expected the load to fail');
}

beforeAll(async () => {
	t = await createTestDatabase();
	const owner = await createTestUser(t.db, 'owner');
	const other = await createTestUser(t.db, 'member');
	member = other.context.user;
	publicId = await createTestTree(t.db, owner);
	privateId = await createTestTree(t.db, owner);
	await addTestMember(t.db, privateId, other, 'viewer');
	await t.db.update(trees).set({ slug: 'the-royal' }).where(eq(trees.id, publicId));
	const name = (await t.db
		.select({ name: trees.name })
		.from(trees)
		.where(eq(trees.id, publicId))
		.get())!.name;
	await new PublicTreeService(t.db).setPublicTree(publicId, name, {
		...owner.context,
		user: { ...owner.context.user, isInstallOwner: true }
	});
}, 60_000);
afterAll(async () => {
	await t.dispose();
});

describe('serverLoad', () => {
	it('refuses a signed-out caller with a 401 and no run', async () => {
		const run = vi.fn();
		expect(await failure(serverLoad({ failure: 'x' }, run)(eventOf(null)))).toMatchObject({
			status: 401
		});
		expect(run).not.toHaveBeenCalled();
	});

	it('refuses the public visitor a load that does not opt in', async () => {
		const run = vi.fn();
		expect(await failure(serverLoad({ failure: 'x' }, run)(eventOf(PUBLIC_VISITOR)))).toMatchObject(
			{ status: 403 }
		);
		expect(run).not.toHaveBeenCalled();
	});

	it('lets the visitor into a load that opts in, and hands it the caller', async () => {
		const result = await serverLoad({ failure: 'x', allowPublicVisitor: true }, ({ ctx }) => ({
			isVisitor: ctx.user.isPublicVisitor
		}))(eventOf(PUBLIC_VISITOR));
		expect(result).toEqual({ isVisitor: true });
	});

	it('hides a binding that is missing behind a 500', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		expect(
			await failure(serverLoad({ failure: 'x' }, vi.fn())(eventOf(member, {}, false)))
		).toMatchObject({ status: 500 });
	});

	it('keeps a domain error’s status and message', async () => {
		const load = serverLoad({ failure: 'x' }, () => {
			throw new NotFoundError('Note', 'n1');
		});
		expect(await failure(load(eventOf(member)))).toEqual({
			status: 404,
			message: "Note 'n1' not found"
		});
	});

	it('answers an unexpected error with the screen’s own failure text, never the cause', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		const load = serverLoad({ failure: 'Failed to load the people' }, () => {
			throw new Error('SQLITE_ERROR: no such table: person');
		});
		expect(await failure(load(eventOf(member)))).toEqual({
			status: 500,
			message: 'Failed to load the people'
		});
	});

	it('lets a redirect through untouched', async () => {
		const load = serverLoad({ failure: 'x' }, () => redirect(302, '/elsewhere'));
		expect(await failure(load(eventOf(member)))).toMatchObject({ status: 302 });
	});
});

describe('treeServerLoad', () => {
	it('registers the dependency that invalidate(DATA_KEY) reloads', async () => {
		const event = eventOf(member, { id: privateId });
		await treeServerLoad({ failure: 'x' }, () => null)(event);
		expect(event.depends).toHaveBeenCalledWith(DATA_KEY);
	});

	it('hands the load the id a slug stands for', async () => {
		const load = treeServerLoad({ failure: 'x' }, ({ treeId }) => treeId);
		expect(await load(eventOf(member, { id: 'the-royal' }))).toBe(publicId);
	});

	it('refuses the visitor a closed load, even on the public tree', async () => {
		const run = vi.fn();
		const load = treeServerLoad({ failure: 'x' }, run);
		expect(await failure(load(eventOf(PUBLIC_VISITOR, { id: publicId })))).toMatchObject({
			status: 403
		});
		expect(run).not.toHaveBeenCalled();
	});

	it('refuses the visitor any tree but the public one, with the same 403 as a closed load', async () => {
		const run = vi.fn();
		const load = treeServerLoad({ failure: 'x', allowPublicVisitor: true }, run);
		const refused = await failure(load(eventOf(PUBLIC_VISITOR, { id: privateId })));
		expect(refused).toMatchObject({ status: 403 });
		expect(await failure(load(eventOf(PUBLIC_VISITOR, { id: 'no-such-tree' })))).toEqual(refused);
		expect(run).not.toHaveBeenCalled();
	});

	it('lets the visitor read the public tree by its slug', async () => {
		const load = treeServerLoad({ failure: 'x', allowPublicVisitor: true }, ({ treeId }) => treeId);
		expect(await load(eventOf(PUBLIC_VISITOR, { id: 'the-royal' }))).toBe(publicId);
	});

	it('passes a segment that names no tree on unchanged, for the service to refuse', async () => {
		const load = treeServerLoad({ failure: 'x' }, ({ treeId }) => treeId);
		expect(await load(eventOf(member, { id: 'no-such-tree' }))).toBe('no-such-tree');
	});
});
