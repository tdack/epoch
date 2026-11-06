/// <reference types="@cloudflare/vitest-plugin/types" />
/**
 * Real-D1 harness for service and repository tests. They run inside workerd (the `d1` Vitest
 * project), on the same SQLite engine the Worker uses, so constraint, cascade and batch behaviour
 * is genuine, which an in-memory fake would not give us.
 */

import { env } from 'cloudflare:test';
import type { D1Database } from '@cloudflare/workers-types';
import { getDb, type DbClient } from '../db';
import { trees, treeMemberships, users } from '../db/schema';
import type { AuthenticatedContext } from '../domain/identity';
import type { TreeRole } from '../../shared/roles';

export interface TestDatabase {
	d1: D1Database;
	db: DbClient;
	dispose: () => Promise<void>;
}

/**
 * The test file's D1, with every migration applied by the project's setup file. Storage is
 * isolated per file, not per call, so a second call in the same file returns the same database:
 * tests keep apart by tree.
 */
export async function createTestDatabase(): Promise<TestDatabase> {
	const d1 = (env as unknown as { DB: D1Database }).DB;
	return { d1, db: getDb(d1), dispose: async () => {} };
}

export interface TestActor {
	context: AuthenticatedContext;
	userId: string;
}

/** Insert a user and return a request context for them. */
export async function createTestUser(db: DbClient, label = 'user'): Promise<TestActor> {
	const id = crypto.randomUUID();
	await db.insert(users).values({
		id,
		accessSub: `sub-${label}-${id}`,
		email: `${label}-${id.slice(0, 6)}@epoch.test`,
		name: label
	});
	return {
		userId: id,
		context: {
			user: { id, accessSub: `sub-${label}-${id}`, email: `${label}@epoch.test`, name: label },
			correlationId: `test-${id}`
		}
	};
}

/** Insert a tree the actor owns. */
export async function createTestTree(
	db: DbClient,
	actor: TestActor,
	role: TreeRole = 'owner'
): Promise<string> {
	const id = crypto.randomUUID();
	await db.insert(trees).values({ id, name: `Test tree ${id.slice(0, 6)}` });
	await db.insert(treeMemberships).values({
		id: crypto.randomUUID(),
		treeId: id,
		userId: actor.userId,
		role
	});
	return id;
}

/** Give another user a role in an existing tree. */
export async function addTestMember(
	db: DbClient,
	treeId: string,
	actor: TestActor,
	role: TreeRole
): Promise<void> {
	await db.insert(treeMemberships).values({
		id: crypto.randomUUID(),
		treeId,
		userId: actor.userId,
		role
	});
}
