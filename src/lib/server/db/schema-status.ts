import type { D1Database } from '@cloudflare/workers-types';
import journal from '../../../../drizzle/meta/_journal.json';

/** What Wrangler records in `d1_migrations.name` for each migration in the Drizzle journal. */
export const EXPECTED_MIGRATIONS: readonly string[] = journal.entries.map((entry) => `${entry.tag}.sql`);

export const SCHEMA_NOT_MIGRATED_CODE = 'SCHEMA_NOT_MIGRATED';

export const SCHEMA_NOT_MIGRATED_MESSAGE =
	'The database schema is missing or out of date. Run `npm run db:migrate:local` for the local ' +
	'database (or `npm run db:migrate` for the remote one), then retry.';

/**
 * Migrations in the journal that the database has not applied. Reads Wrangler's own bookkeeping
 * table rather than probing for tables, so a partly applied set is caught too, and the
 * `drizzle/` migrations stay the only definition of the schema.
 */
export async function pendingMigrations(d1: D1Database): Promise<string[]> {
	let applied: Set<string>;
	try {
		const { results } = await d1.prepare('SELECT name FROM d1_migrations').all<{ name: string }>();
		applied = new Set(results.map((row) => row.name));
	} catch {
		// No bookkeeping table: nothing has been migrated (or it was built some other way).
		applied = new Set();
	}
	return EXPECTED_MIGRATIONS.filter((name) => !applied.has(name));
}

let isKnownCurrent = false;

/**
 * True once the database has every migration. Only success is remembered, per isolate, so
 * running the migration takes effect on the next request without a restart.
 */
export async function isSchemaCurrent(d1: D1Database): Promise<boolean> {
	if (isKnownCurrent) return true;
	isKnownCurrent = (await pendingMigrations(d1)).length === 0;
	return isKnownCurrent;
}

/** Thrown outside a request (queue consumer, workflow) where there is no 503 to return. */
export class SchemaNotMigratedError extends Error {
	readonly code = SCHEMA_NOT_MIGRATED_CODE;
	constructor(readonly pending: string[]) {
		super(SCHEMA_NOT_MIGRATED_MESSAGE);
		this.name = 'SchemaNotMigratedError';
	}
}

export async function assertSchemaCurrent(d1: D1Database): Promise<void> {
	if (await isSchemaCurrent(d1)) return;
	throw new SchemaNotMigratedError(await pendingMigrations(d1));
}

/** Test hook: forget a remembered success. */
export function resetSchemaStatusCache(): void {
	isKnownCurrent = false;
}
