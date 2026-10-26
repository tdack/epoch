/** The map's data over a real database: what a restricted viewer may learn, and living people's homes (ADR-078). */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TreeRole } from '../../shared/roles';
import { importGedcomToDb } from '../testing/gedcom';
import {
	addTestMember,
	createTestDatabase,
	createTestTree,
	createTestUser,
	type TestActor,
	type TestDatabase
} from '../testing/d1';
import { PlaceService } from './place-service';

const at = (place: string, lat: string, lng: string) =>
	`2 PLAC ${place}\n3 MAP\n4 LATI ${lat}\n4 LONG ${lng}\n`;

const FIXTURE = [
	'0 HEAD',
	// Dead: every kind of fact counts.
	`0 @I1@ INDI\n1 NAME Alice /Dead/\n1 BIRT\n2 DATE 1850\n${at('Cork', 'N51.9', 'W8.47')}1 RESI\n2 DATE 1870\n${at('Hobart', 'S42.88', 'E147.33')}1 CENS\n2 DATE 1881\n${at('Bath', 'N51.38', 'W2.36')}`,
	// Living: birth place counts for the owner, home and census never do.
	`0 @I2@ INDI\n1 NAME Dana /Aliveson/\n1 BIRT\n2 DATE 1995\n${at('Cork', 'N51.9', 'W8.47')}1 RESI\n2 DATE 2010\n${at('Livingtown', 'N10', 'E10')}1 CENS\n2 DATE 2011\n${at('Hobart', 'S42.88', 'E147.33')}`,
	// Only a living person's home: no place at all.
	`0 @I3@ INDI\n1 NAME Ed /Aliveson/\n1 RESI\n2 DATE 2015\n${at('Homeville', 'N20', 'E20')}`,
	// Private: absent for a restricted viewer whatever the fact.
	`0 @I4@ INDI\n1 NAME Pat /Hidden/\n1 BIRT\n2 DATE 1700\n${at('Secretstown', 'N30', 'E30')}`,
	// A place with no coordinates.
	`0 @I5@ INDI\n1 NAME Una /Dead/\n1 BIRT\n2 DATE 1800\n2 PLAC Nowhere`,
	'0 TRLR'
].join('\n');

const NOW = new Date('2026-10-01T12:00:00Z');
let t: TestDatabase;
let treeId: string;
const actors = {} as Record<TreeRole, TestActor>;
const places = () => new PlaceService(t.db, () => NOW);
const mapAs = async (who: TreeRole) => (await places().mapData(treeId, actors[who].context)).points;
const byName = (points: Awaited<ReturnType<typeof mapAs>>) =>
	Object.fromEntries(points.map((p) => [p.name, [p.factCount, p.peopleCount]]));

beforeAll(async () => {
	t = await createTestDatabase();
	actors.owner = await createTestUser(t.db, 'owner');
	treeId = await createTestTree(t.db, actors.owner);
	for (const role of ['contributor', 'viewer'] as const) {
		actors[role] = await createTestUser(t.db, role);
		await addTestMember(t.db, treeId, actors[role], role);
	}
	await importGedcomToDb(t.d1, treeId, FIXTURE, 'Map');
	await t.d1.prepare(`update individuals set privacy = 'private' where given_name = 'Pat'`).run();
}, 60_000);
afterAll(async () => {
	await t.dispose();
});

describe('the map data', () => {
	it('leaves out living people’s residence and census facts, even for the owner', async () => {
		// Hobart: Alice's residence counts, Dana's census does not. Cork: both births count.
		expect(byName(await mapAs('owner'))).toEqual({
			Bath: [1, 1],
			Cork: [2, 2],
			Hobart: [1, 1],
			Secretstown: [1, 1]
		});
	});

	it('leaves out an unlocated place and counts it as unlocated', async () => {
		const data = await places().mapData(treeId, actors.owner.context);
		expect(data.points.map((p) => p.name)).not.toContain('Nowhere');
		expect(data.unlocatedCount).toBe(1);
	});

	it.each(['viewer', 'contributor'] as const)(
		'answers a %s without a hidden person’s place or a living person’s fact',
		async (role) => {
			const points = await mapAs(role);
			expect(byName(points)).toEqual({ Bath: [1, 1], Cork: [1, 1], Hobart: [1, 1] });
			expect(JSON.stringify(await places().mapData(treeId, actors[role].context))).not.toMatch(
				/Secretstown|Livingtown|Homeville|N30|"latitude":30/
			);
		}
	);

	it('filters the list to unlocated places', async () => {
		const page = await places().list(
			treeId,
			{ isUnlocated: true, limit: 100 },
			actors.owner.context
		);
		expect(page.items.map((p) => p.name)).toEqual(['Nowhere']);
	});
});
