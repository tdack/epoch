/**
 * Prints what a write costs before it is scoped (ADR-055): rows D1 returns, round trips and wall
 * time for the common edits, on a Simpsons-sized tree and on the 5,324-person corpus. Skipped unless
 * RECORD_WRITE_COST=1, so it never runs in the push gate; run it on purpose and paste the table into
 * docs/query-plans.md.
 *
 * Run: RECORD_WRITE_COST=1 npx vitest run --project server src/lib/server/services/write-cost.record.test.ts
 */
import type { D1Database, D1PreparedStatement } from '@cloudflare/workers-types';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, it } from 'vitest';
import simpsons from '../../../../test/data/The Simpsons.ged?raw';
import { getDb } from '../db';
import { events, individuals, personNames } from '../db/schema';
import { insertCorpus } from '../testing/corpus';
import {
	createTestDatabase,
	createTestTree,
	createTestUser,
	type TestActor,
	type TestDatabase
} from '../testing/d1';
import { importGedcomToDb } from '../testing/gedcom';
import { ChangeLogService } from './change-log-service';
import { FactService } from './fact-service';
import { NameService } from './name-service';
import { PersonService } from './person-service';
import { RelationshipService } from './relationship-service';

interface Tally {
	rows: number;
	roundTrips: number;
}

/**
 * Wraps the D1 binding so every statement and batch is counted. A batch is one round trip however
 * many statements it carries, which is the unit that costs latency; rows are summed from results.
 */
function counting(d1: D1Database, tally: Tally): D1Database {
	const real = new WeakMap<object, D1PreparedStatement>();
	const wrap = (stmt: D1PreparedStatement): D1PreparedStatement => {
		const wrapped = {
			bind: (...args: unknown[]) => wrap(stmt.bind(...args)),
			all: async () => {
				tally.roundTrips++;
				const result = await stmt.all();
				tally.rows += result.results.length;
				return result;
			},
			raw: async (options?: unknown) => {
				tally.roundTrips++;
				const result = await (stmt.raw as (o?: unknown) => Promise<unknown[]>)(options);
				tally.rows += result.length;
				return result;
			},
			run: async () => {
				tally.roundTrips++;
				return stmt.run();
			},
			first: async (column?: string) => {
				tally.roundTrips++;
				const result = await (stmt.first as (c?: string) => Promise<unknown>)(column);
				if (result !== null) tally.rows += 1;
				return result;
			}
		} as unknown as D1PreparedStatement;
		real.set(wrapped, stmt);
		return wrapped;
	};
	return {
		prepare: (query: string) => wrap(d1.prepare(query)),
		batch: async (statements: D1PreparedStatement[]) => {
			tally.roundTrips++;
			const results = await d1.batch(statements.map((s) => real.get(s) ?? s));
			for (const result of results) tally.rows += result.results?.length ?? 0;
			return results;
		},
		exec: (query: string) => d1.exec(query),
		dump: () => d1.dump()
	} as unknown as D1Database;
}

interface Row {
	tree: string;
	write: string;
	rows: number;
	roundTrips: number;
	ms: number;
}

let t: TestDatabase;
let actor: TestActor;
const table: Row[] = [];

beforeAll(async () => {
	t = await createTestDatabase();
	actor = await createTestUser(t.db);
});
afterAll(async () => {
	if (table.length > 0) {
		const lines = [
			'| Tree | Write | Rows returned | Round trips | Wall ms |',
			'| --- | --- | ---: | ---: | ---: |',
			...table.map((r) => `| ${r.tree} | ${r.write} | ${r.rows} | ${r.roundTrips} | ${r.ms} |`)
		];
		console.log(`\n${lines.join('\n')}\n`);
	}
	await t.dispose();
});

async function measure(
	tree: string,
	write: string,
	run: (db: ReturnType<typeof getDb>) => Promise<unknown>
) {
	const tally: Tally = { rows: 0, roundTrips: 0 };
	const db = getDb(counting(t.d1, tally));
	const started = performance.now();
	await run(db);
	table.push({
		tree,
		write,
		rows: tally.rows,
		roundTrips: tally.roundTrips,
		ms: Math.round(performance.now() - started)
	});
}

async function measureWrites(label: string, treeId: string) {
	const ctx = actor.context;
	const people = new PersonService(t.db);
	const person = (await people.create(treeId, { givenName: 'Wren', surname: 'Ash' }, ctx))
		.individual;
	const other = (await people.create(treeId, { givenName: 'Ivor', surname: 'Ash' }, ctx))
		.individual;
	const created = await new FactService(t.db).create(
		treeId,
		person.id,
		{
			type: 'BIRT',
			dateText: '4 MAR 1900',
			place: 'Leeds',
			value: null,
			cause: null,
			age: null,
			notes: null
		},
		ctx
	);
	const fact = (await t.db.select().from(events).where(eq(events.id, created.factId)).all())[0]!;
	const name = (
		await t.db.select().from(personNames).where(eq(personNames.personId, person.id)).all()
	)[0]!;
	// Read after the earlier edits: a name or fact edit bumps the person's version too.
	const storedVersion = async () =>
		(await t.db.select().from(individuals).where(eq(individuals.id, person.id)).all())[0]!.version;

	await measure(label, 'fact edit', (db) =>
		new FactService(db).update(treeId, fact.id, { place: 'York' }, fact.version, ctx)
	);
	await measure(label, 'undo of the fact edit', (db) =>
		new ChangeLogService(db).undoLast(treeId, ctx)
	);
	await measure(label, 'name edit', (db) =>
		new NameService(db).update(treeId, name.id, { givenName: 'Wrenna' }, name.version, ctx)
	);
	const version = await storedVersion();
	await measure(label, 'person update (update_person)', (db) =>
		new PersonService(db).update(treeId, person.id, version, { givenName: 'Wren W' }, ctx)
	);
	await measure(label, 'add partner', (db) =>
		new RelationshipService(db).execute(
			treeId,
			{
				kind: 'add_partner',
				person: { id: person.id, givenName: 'Wren W', surname: 'Ash' },
				partner: { id: other.id, givenName: 'Ivor', surname: 'Ash' },
				unionLabel: null
			},
			ctx
		)
	);
}

describe.skipIf(process.env.RECORD_WRITE_COST !== '1')(
	'write cost before scoping (ADR-055)',
	() => {
		it('a Simpsons-sized tree', async () => {
			const treeId = await createTestTree(t.db, actor);
			await importGedcomToDb(t.d1, treeId, simpsons, 'Simpsons');
			await measureWrites('The Simpsons', treeId);
		}, 120_000);

		it('the 5,324-person corpus', async () => {
			const treeId = await createTestTree(t.db, actor);
			await insertCorpus(t.db, treeId, { prefix: treeId.slice(0, 8), shouldNameThePeople: true });
			await measureWrites('Corpus (5,324 people)', treeId);
		}, 600_000);
	}
);
