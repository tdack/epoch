import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getTableConfig, SQLiteTable } from 'drizzle-orm/sqlite-core';
import { is } from 'drizzle-orm';
import * as schema from './schema';
import { createTestDatabase, type TestDatabase } from '../testing/d1';
import {
	assertSchemaCurrent,
	EXPECTED_MIGRATIONS,
	isSchemaCurrent,
	pendingMigrations,
	resetSchemaStatusCache,
	SchemaNotMigratedError
} from './schema-status';

let t: TestDatabase;
beforeAll(async () => {
	t = await createTestDatabase();
});
afterAll(async () => {
	await t.dispose();
});

describe('the Drizzle schema and the migrations agree', () => {
	interface Column {
		name: string;
		type: string;
		isRequired: boolean;
		isPrimaryKey: boolean;
	}
	const declared = new Map<string, { columns: Column[]; indexes: string[] }>();
	for (const value of Object.values(schema)) {
		if (!is(value, SQLiteTable)) continue;
		const config = getTableConfig(value);
		// A composite key is declared on the table, not on its columns.
		const keyed = new Set(config.primaryKeys.flatMap((k) => k.columns.map((c) => c.name)));
		declared.set(config.name, {
			columns: config.columns.map((c) => ({
				name: c.name,
				type: c.getSQLType().toLowerCase(),
				isRequired: c.notNull,
				isPrimaryKey: c.primary || keyed.has(c.name)
			})),
			indexes: config.indexes.map((i) => i.config.name)
		});
	}

	async function all<T>(sql: string): Promise<T[]> {
		return (await t.d1.prepare(sql).all<T>()).results;
	}

	it('has the same tables', async () => {
		// The name index and its key table are migration-only by design: Drizzle cannot declare a
		// virtual table or a trigger, and the index is never read through the schema (ADR-049).
		const tables = (
			await all<{ name: string }>(
				"SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name NOT LIKE 'name_fts%'"
			)
		).map((r) => r.name);
		expect(tables.sort()).toEqual([...declared.keys()].sort());
	});

	// Columns the code no longer declares whose drop migration is held until that code is live
	// (expand-and-contract; see the backlog). Empty this when the drop migration lands.
	const RETIRED_COLUMNS: Readonly<Record<string, readonly string[]>> = {};

	it.each([...declared.keys()])(
		'%s has the same columns, types, nullability and indexes',
		async (table) => {
			const actual = await all<{ name: string; type: string; notnull: number; pk: number }>(
				`PRAGMA table_info('${table}')`
			);
			const retired = new Set(RETIRED_COLUMNS[table] ?? []);
			const migrated = actual
				.filter((c) => !retired.has(c.name))
				.map((c) => ({
					name: c.name,
					type: c.type.toLowerCase(),
					isRequired: c.notnull === 1 || c.pk > 0,
					isPrimaryKey: c.pk > 0
				}));
			const expected = declared
				.get(table)!
				.columns.map((c) => ({ ...c, isRequired: c.isRequired || c.isPrimaryKey }));
			const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);
			expect(migrated.sort(byName)).toEqual(expected.sort(byName));

			const indexes = (await all<{ name: string }>(`PRAGMA index_list('${table}')`))
				.map((i) => i.name)
				.filter((n) => !n.startsWith('sqlite_autoindex'));
			// Every index the schema names must exist; the migrations may add unique constraints under generated names.
			for (const name of declared.get(table)!.indexes) expect(indexes).toContain(name);
		}
	);
});

describe('schema status', () => {
	beforeEach(async () => {
		resetSchemaStatusCache();
		await t.d1.prepare('DROP TABLE IF EXISTS d1_migrations').run();
	});

	async function recordApplied(names: readonly string[]) {
		await t.d1
			.prepare(
				'CREATE TABLE IF NOT EXISTS d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL)'
			)
			.run();
		for (const name of names)
			await t.d1.prepare('INSERT INTO d1_migrations (name) VALUES (?)').bind(name).run();
	}

	it('lists every migration as pending when nothing was applied through Wrangler', async () => {
		expect(await pendingMigrations(t.d1)).toEqual([...EXPECTED_MIGRATIONS]);
		expect(await isSchemaCurrent(t.d1)).toBe(false);
	});

	it('rethrows a database failure that is not a missing table', async () => {
		const broken = {
			prepare: () => ({
				all: async () => {
					throw new Error('D1_ERROR: Network connection lost');
				}
			})
		} as unknown as typeof t.d1;
		await expect(pendingMigrations(broken)).rejects.toThrow(/Network connection lost/);
	});

	it('names only the migrations that are missing', async () => {
		await recordApplied(EXPECTED_MIGRATIONS.slice(0, -1));
		expect(await pendingMigrations(t.d1)).toEqual([EXPECTED_MIGRATIONS.at(-1)]);
		await expect(assertSchemaCurrent(t.d1)).rejects.toThrow(/npm run db:migrate:local/);
	});

	it('passes once every migration is recorded, and takes effect without a restart', async () => {
		await expect(assertSchemaCurrent(t.d1)).rejects.toBeInstanceOf(SchemaNotMigratedError);
		await recordApplied(EXPECTED_MIGRATIONS);
		await expect(assertSchemaCurrent(t.d1)).resolves.toBeUndefined();
	});
});
