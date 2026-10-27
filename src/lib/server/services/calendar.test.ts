/** The calendar is the Overview's anniversaries over the viewer's masked rows, for a month or the year. */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { importGedcomToDb } from '../testing/gedcom';
import {
	addTestMember,
	createTestDatabase,
	createTestTree,
	createTestUser,
	type TestActor,
	type TestDatabase
} from '../testing/d1';
import { OverviewService } from './overview-service';

const FIXTURE = `0 HEAD
0 @I1@ INDI
1 NAME Old /Hill/
1 BIRT
2 DATE 12 MAY 1850
1 DEAT
2 DATE 3 JUN 1920
0 @I2@ INDI
1 NAME Wynne /Hill/
1 BIRT
2 DATE 1 MAY 1855
0 @I3@ INDI
1 NAME Liv /Ross/
1 BIRT
2 DATE 20 MAY 1990
0 @I4@ INDI
1 NAME Year /Only/
1 BIRT
2 DATE MAY 1850
0 @F1@ FAM
1 HUSB @I1@
1 WIFE @I2@
1 MARR
2 DATE 8 MAY 1875
0 @F2@ FAM
1 HUSB @I1@
1 WIFE @I3@
1 MARR
2 DATE 9 MAY 1995
0 TRLR`;

let t: TestDatabase;
let treeId: string;
let owner: TestActor;
let viewer: TestActor;
const NOW = Date.parse('2026-10-01T12:00:00Z');
const overview = () => new OverviewService(t.db, () => NOW);
const describeAll = (rows: Awaited<ReturnType<OverviewService['calendar']>>) =>
	rows.map((a) => `${a.monthDay} ${a.type} ${a.people.map((p) => p.name).join('+')}`);

beforeAll(async () => {
	t = await createTestDatabase();
	owner = await createTestUser(t.db, 'owner');
	treeId = await createTestTree(t.db, owner);
	viewer = await createTestUser(t.db, 'viewer');
	await addTestMember(t.db, treeId, viewer, 'viewer');
	await importGedcomToDb(t.d1, treeId, FIXTURE, 'Calendar');
}, 60_000);
afterAll(async () => {
	await t.dispose();
});

describe('OverviewService.calendar', () => {
	it('lists exact days of one month in day order, and leaves out a month-only date', async () => {
		expect(describeAll(await overview().calendar(treeId, owner.context, 5))).toEqual([
			'05-01 BIRT Wynne Hill',
			'05-08 MARR Old Hill+Wynne Hill',
			'05-09 MARR Old Hill+Liv Ross',
			'05-12 BIRT Old Hill',
			'05-20 BIRT Liv Ross'
		]);
	});

	it('carries the whole year when no month is asked for', async () => {
		const all = await overview().calendar(treeId, owner.context);
		expect(all.map((a) => a.monthDay)).toContain('06-03');
		expect(all).toHaveLength(6);
	});

	it('never shows a viewer a living person, or a partnership with one', async () => {
		const seen = describeAll(await overview().calendar(treeId, viewer.context, 5));
		expect(seen.join('\n')).not.toContain('Liv Ross');
		expect(seen).toEqual([
			'05-01 BIRT Wynne Hill',
			'05-08 MARR Old Hill+Wynne Hill',
			'05-12 BIRT Old Hill'
		]);
	});
});
