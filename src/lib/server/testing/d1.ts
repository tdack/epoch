/**
 * Real-D1 harness for service and repository tests. Wrangler's platform proxy boots the same
 * SQLite engine the Worker uses, so constraint, cascade and batch behaviour is genuine, which an
 * in-memory fake would not give us.
 */

import { getPlatformProxy } from 'wrangler';
import type { D1Database } from '@cloudflare/workers-types';
import { getDb, type DbClient } from '../db';
import { trees, treeMemberships, users } from '../db/schema';
import type { AuthenticatedContext } from '../domain/identity';
import journal from '../../../../drizzle/meta/_journal.json';

/** Migration SQL keyed by path, inlined by Vite so no filesystem types are needed. */
const MIGRATION_SQL = import.meta.glob('../../../../drizzle/*.sql', {
	query: '?raw',
	import: 'default',
	eager: true
}) as Record<string, string>;
const STATEMENT_BREAKPOINT = '--> statement-breakpoint';

export interface TestDatabase {
	d1: D1Database;
	db: DbClient;
	dispose: () => Promise<void>;
}

/** Split a drizzle migration file into its statements. */
function statementsOf(sql: string): string[] {
	return sql
		.split(STATEMENT_BREAKPOINT)
		.map((s) => s.trim())
		.filter(Boolean);
}

/**
 * Boot an isolated in-memory D1 with every migration applied in journal order. `persist: false`
 * keeps tests off the `.wrangler` state the dev server uses.
 */
export async function createTestDatabase(): Promise<TestDatabase> {
	const proxy = await getPlatformProxy<{ DB: D1Database }>({
		configPath: new URL('../../../../wrangler.jsonc', import.meta.url).pathname,
		persist: false
	});
	const d1 = proxy.env.DB;

	for (const { tag } of journal.entries) {
		const sql = MIGRATION_SQL[`../../../../drizzle/${tag}.sql`];
		if (!sql) throw new Error(`Migration ${tag}.sql is in the journal but missing on disk`);
		for (const statement of statementsOf(sql)) {
			await d1.prepare(statement).run();
		}
	}

	return { d1, db: getDb(d1), dispose: () => proxy.dispose() };
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
	role: 'owner' | 'editor' | 'viewer' = 'owner'
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
	role: 'owner' | 'editor' | 'viewer'
): Promise<void> {
	await db.insert(treeMemberships).values({
		id: crypto.randomUUID(),
		treeId,
		userId: actor.userId,
		role
	});
}
