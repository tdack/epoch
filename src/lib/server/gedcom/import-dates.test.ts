import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import windsors from '../../../../test/data/The Windsors.ged?raw';
import dirty from '../../../../test/data/The Simpsons duplicate families.ged?raw';
import { events } from '../db/schema';
import {
	createTestDatabase,
	createTestTree,
	createTestUser,
	type TestDatabase
} from '../testing/d1';
import { PersonService } from '../services/person-service';
import { ChangeLogService } from '../services/change-log-service';
import {
	backfillStatements,
	DATED_TABLES,
	staleDatesSql,
	type StoredDateRow
} from '../domain/date-backfill';
import { normalizeGedcomDate } from './parser';
import { importGedcomToDb } from '../testing/gedcom';

const IMPORT_MS = 30_000;

let t: TestDatabase;
beforeAll(async () => {
	t = await createTestDatabase();
});
afterAll(async () => {
	await t.dispose();
});

const eventsOf = (treeId: string) =>
	t.db.select().from(events).where(eq(events.treeId, treeId)).all();

describe('persisting date bounds, precision and qualifier (ADR-004)', () => {
	it.each([
		['The Windsors.ged', windsors, '21 APR 1926', '1926-04-21'],
		['The Simpsons duplicate families.ged', dirty, '3 Nov 2014', '2014-11-03']
	])(
		'stores every dated event in %s with its bounds and precision',
		async (_name, file, dayRaw, dayIso) => {
			const treeId = crypto.randomUUID();
			await importGedcomToDb(t.d1, treeId, file, 'Dated');
			const dated = (await eventsOf(treeId)).filter((e) => e.dateRaw);
			expect(dated.length).toBeGreaterThan(0);
			for (const e of dated) {
				expect(e.dateQualifier, e.dateRaw!).not.toBeNull();
				expect(e.datePrecision, e.dateRaw!).not.toBeNull();
				// The lower bound is what date_sort has always held.
				expect(e.dateSort, e.dateRaw!).toBe(normalizeGedcomDate(e.dateRaw!).sort ?? null);
			}
			// A full day is stored as that day, once, at both ends: nothing widened, nothing narrowed.
			const fullDay = dated.find((e) => e.dateRaw === dayRaw)!;
			expect(fullDay).toMatchObject({
				dateSort: dayIso,
				dateSortEnd: dayIso,
				datePrecision: 'DAY',
				dateQualifier: 'EXACT'
			});
			// The original text is untouched, including its casing.
			expect(dated.map((e) => e.dateRaw)).toContain(dayRaw);
		},
		// The Windsors file has far more events than the duplicate-families fixture.
		IMPORT_MS
	);

	it('never turns 1900 or ABT 1900 into a day', async () => {
		const treeId = crypto.randomUUID();
		const ged = [
			'0 HEAD',
			'0 @I1@ INDI',
			'1 NAME Year /Only/',
			'1 BIRT',
			'2 DATE 1900',
			'1 DEAT',
			'2 DATE ABT 1950',
			'0 @I2@ INDI',
			'1 NAME Range /Case/',
			'1 BIRT',
			'2 DATE BET 1860 AND 1865',
			'0 TRLR'
		].join('\n');
		await importGedcomToDb(t.d1, treeId, ged, 'Partial dates');
		const byRaw = new Map((await eventsOf(treeId)).map((e) => [e.dateRaw, e]));
		expect(byRaw.get('1900')).toMatchObject({
			dateSort: '1900-01-01',
			dateSortEnd: '1900-12-31',
			datePrecision: 'YEAR',
			dateQualifier: 'EXACT'
		});
		expect(byRaw.get('ABT 1950')).toMatchObject({
			dateSort: '1950-01-01',
			dateSortEnd: '1950-12-31',
			datePrecision: 'YEAR',
			dateQualifier: 'ABOUT'
		});
		expect(byRaw.get('BET 1860 AND 1865')).toMatchObject({
			dateSort: '1860-01-01',
			dateSortEnd: '1865-12-31',
			dateQualifier: 'BETWEEN'
		});
	});
});

describe('editing dates and undoing the edit', () => {
	async function setup() {
		const actor = await createTestUser(t.db);
		const treeId = await createTestTree(t.db, actor);
		return {
			treeId,
			ctx: actor.context,
			people: new PersonService(t.db),
			log: new ChangeLogService(t.db)
		};
	}
	const birthOf = async (treeId: string) =>
		(await eventsOf(treeId)).find((e) => e.type === 'BIRT')!;
	const columns = (e: Awaited<ReturnType<typeof birthOf>>) => ({
		dateRaw: e.dateRaw,
		dateSort: e.dateSort,
		dateSortEnd: e.dateSortEnd,
		dateQualifier: e.dateQualifier,
		datePrecision: e.datePrecision,
		dateCalendar: e.dateCalendar
	});

	it('writes the columns on create and on edit, and an undo restores every one of them', async () => {
		const s = await setup();
		const { individual } = await s.people.create(
			s.treeId,
			{ givenName: 'Ada', birthDate: '1815' },
			s.ctx
		);
		const created = columns(await birthOf(s.treeId));
		expect(created).toMatchObject({
			dateRaw: '1815',
			dateSort: '1815-01-01',
			dateSortEnd: '1815-12-31',
			datePrecision: 'YEAR',
			dateQualifier: 'EXACT'
		});

		await s.people.update(
			s.treeId,
			individual.id,
			individual.version,
			{ birthDate: 'ABT 10 DEC 1815' },
			s.ctx
		);
		expect(columns(await birthOf(s.treeId))).toMatchObject({
			dateQualifier: 'ABOUT',
			datePrecision: 'DAY',
			dateSort: '1815-12-10'
		});

		await s.log.undoLast(s.treeId, s.ctx);
		expect(columns(await birthOf(s.treeId))).toEqual(created);
	});

	it('an undone deletion brings the event back with its structured date', async () => {
		const s = await setup();
		const { individual } = await s.people.create(
			s.treeId,
			{ givenName: 'Ada', birthDate: 'BET 1810 AND 1815' },
			s.ctx
		);
		const before = columns(await birthOf(s.treeId));
		await s.people.remove(s.treeId, individual.id, s.ctx);
		expect(await eventsOf(s.treeId)).toHaveLength(0);
		await s.log.undoLast(s.treeId, s.ctx);
		expect(columns(await birthOf(s.treeId))).toEqual(before);
		expect(before.dateQualifier).toBe('BETWEEN');
	});
});

describe('backfilling stored event dates', () => {
	const events = DATED_TABLES[0];
	const backfill = async (ids: string[]) => {
		const { results } = await t.d1.prepare(staleDatesSql(events)).all<StoredDateRow>();
		const statements = backfillStatements(
			events,
			results.filter((r) => ids.includes(r.id))
		);
		for (const statement of statements) await t.d1.prepare(statement).run();
		return statements.length;
	};

	it('fills unbackfilled rows and re-sorts dual dates, leaving version and updated_at alone', async () => {
		const treeId = crypto.randomUUID();
		await importGedcomToDb(
			t.d1,
			treeId,
			'0 HEAD\n0 @I1@ INDI\n1 NAME A /B/\n1 BIRT\n2 DATE 1900\n1 DEAT\n2 DATE 30 JAN 1648/49\n0 TRLR',
			'Old'
		);
		const byDate = async () => {
			const rows = await eventsOf(treeId);
			return [rows.find((r) => r.dateRaw === '1900')!, rows.find((r) => r.dateRaw !== '1900')!];
		};
		const [birth, death] = await byDate();
		await t.d1
			.prepare(
				'UPDATE events SET date_sort_end = NULL, date_qualifier = NULL, date_precision = NULL, date_calendar = NULL, version = 7, updated_at = 5 WHERE id = ?'
			)
			.bind(birth.id)
			.run();
		// How the parser stored a dual date before it sorted on the later year.
		await t.d1
			.prepare(
				"UPDATE events SET date_sort = '1648-01-30', date_sort_end = '1648-01-30', version = 7, updated_at = 5 WHERE id = ?"
			)
			.bind(death.id)
			.run();

		expect(await backfill([birth.id, death.id])).toBe(2);

		const [birthAfter, deathAfter] = await byDate();
		expect(birthAfter).toMatchObject({
			dateRaw: '1900',
			dateSort: '1900-01-01',
			dateSortEnd: '1900-12-31',
			dateQualifier: 'EXACT',
			datePrecision: 'YEAR',
			version: 7
		});
		expect(birthAfter.updatedAt?.getTime()).toBe(5000);
		expect(deathAfter).toMatchObject({
			dateRaw: '30 JAN 1648/49',
			dateSort: '1649-01-30',
			dateSortEnd: '1649-01-30',
			dateCalendar: 'JULIAN',
			version: 7
		});
		expect(deathAfter.updatedAt?.getTime()).toBe(5000);
		expect(await backfill([birth.id, death.id])).toBe(0);
	});
});
