/** The Overview's figures over real rows: a restricted viewer's never count a hidden person. */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { trees } from '../db/schema';
import { PUBLIC_VISITOR } from '../domain/identity';
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
2 DATE 1850
1 DEAT
2 DATE 1920
0 @I2@ INDI
1 NAME Young /Hill/
1 BIRT
2 DATE 1990
0 @I3@ INDI
1 NAME Liv /Ross/
1 BIRT
2 DATE 2 OCT 1990
0 @F1@ FAM
1 HUSB @I1@
1 WIFE @I2@
0 TRLR`;

let t: TestDatabase;
let treeId: string;
let owner: TestActor;
let viewer: TestActor;
const NOW = Date.parse('2026-10-01T12:00:00Z');
const overview = () => new OverviewService(t.db, () => NOW);

beforeAll(async () => {
	t = await createTestDatabase();
	owner = await createTestUser(t.db, 'owner');
	treeId = await createTestTree(t.db, owner);
	viewer = await createTestUser(t.db, 'viewer');
	await addTestMember(t.db, treeId, viewer, 'viewer');
	await importGedcomToDb(t.d1, treeId, FIXTURE, 'Overview');
}, 60_000);
afterAll(async () => {
	await t.dispose();
});

describe('OverviewService', () => {
	it('counts everyone for the owner', async () => {
		const { stats, today } = await overview().load(treeId, owner.context);
		expect(today).toBe('2026-10-01');
		expect(stats).toMatchObject({
			people: 3,
			partnerships: 1,
			birthsByCentury: [
				{ century: 1800, people: 1 },
				{ century: 1900, people: 2 }
			],
			topSurnames: [
				{ surname: 'Hill', people: 2 },
				{ surname: 'Ross', people: 1 }
			]
		});
	});

	it('leaves a living person and their partnership out for a viewer', async () => {
		const { stats } = await overview().load(treeId, viewer.context);
		expect(stats).toMatchObject({
			people: 1,
			partnerships: 0,
			birthsByCentury: [{ century: 1800, people: 1 }],
			topSurnames: [{ surname: 'Hill', people: 1 }]
		});
	});

	it('lists the latest changes only for an editor or above', async () => {
		const forOwner = await overview().load(treeId, owner.context);
		const forViewer = await overview().load(treeId, viewer.context);
		expect(forOwner.work.recentChanges).toBeInstanceOf(Array);
		expect(forViewer.work.recentChanges).toBeNull();
		expect(forViewer.work.myTasks).toEqual({ items: [], open: 0 });
	});

	it('keeps a living birthday for members of a public tree, and from its visitors', async () => {
		await t.db.update(trees).set({ isPublic: true }).where(eq(trees.id, treeId));
		try {
			const birthdays = async (context: typeof owner.context) =>
				(await overview().load(treeId, context)).anniversaries
					.filter((a) => a.type === 'BIRT')
					.map((a) => [a.people[0]!.name, a.isCurrent]);
			expect(await birthdays(owner.context)).toEqual([['Liv Ross', true]]);
			expect(await birthdays({ user: PUBLIC_VISITOR, correlationId: 'public' })).toEqual([]);
		} finally {
			await t.db.update(trees).set({ isPublic: false }).where(eq(trees.id, treeId));
		}
	});
});
