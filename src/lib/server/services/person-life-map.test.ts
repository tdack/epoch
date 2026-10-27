/** The person page's fact locations over a real database (ADR-078). */

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
import { PersonPageService } from './person-page-service';

const at = (place: string, lat: string, lng: string) =>
	`2 PLAC ${place}\n3 MAP\n4 LATI ${lat}\n4 LONG ${lng}\n`;

const FIXTURE = [
	'0 HEAD',
	// Dead: the birth, the residence and an unlocated death all show.
	`0 @I1@ INDI\n1 NAME Alice /Dead/\n1 BIRT\n2 DATE 1850\n${at('Cork', 'N51.9', 'W8.47')}1 RESI\n2 DATE 1870\n${at('Hobart', 'S42.88', 'E147.33')}1 DEAT\n2 DATE 1930\n2 PLAC Nowhere`,
	// Living: the birth place maps, the home and census never do.
	`0 @I2@ INDI\n1 NAME Dana /Aliveson/\n1 BIRT\n2 DATE 1995\n${at('Cork', 'N51.9', 'W8.47')}1 RESI\n2 DATE 2010\n${at('Livingtown', 'N10', 'E10')}1 CENS\n2 DATE 2011\n${at('Hobart', 'S42.88', 'E147.33')}`,
	'0 TRLR'
].join('\n');

const NOW = new Date('2026-10-01T12:00:00Z');
let t: TestDatabase;
let treeId: string;
const ids: Record<string, string> = {};
const actors = {} as Record<TreeRole, TestActor>;
const page = (who: TreeRole, name: string) =>
	new PersonPageService(t.db, () => NOW).getPerson(treeId, ids[name]!, actors[who].context);
/** Types of the facts that carry a location, in the page's order. */
const mappedTypes = async (who: TreeRole, name: string) => {
	const dto = await page(who, name);
	return dto.facts.filter((f) => dto.factLocations[f.id]).map((f) => f.type);
};

beforeAll(async () => {
	t = await createTestDatabase();
	actors.owner = await createTestUser(t.db, 'owner');
	treeId = await createTestTree(t.db, actors.owner);
	actors.viewer = await createTestUser(t.db, 'viewer');
	await addTestMember(t.db, treeId, actors.viewer, 'viewer');
	await importGedcomToDb(t.d1, treeId, FIXTURE, 'Life');
	for (const [name, given] of [
		['alice', 'Alice'],
		['dana', 'Dana']
	] as const) {
		const row = await t.d1
			.prepare(`select id from individuals where tree_id = ? and given_name = ?`)
			.bind(treeId, given)
			.first<{ id: string }>();
		ids[name] = row!.id;
	}
}, 60_000);
afterAll(async () => {
	await t.dispose();
});

describe('the person page’s fact locations', () => {
	it('attaches a location to each fact whose place has one', async () => {
		const dto = await page('owner', 'alice');
		expect(await mappedTypes('owner', 'alice')).toEqual(['BIRT', 'RESI']);
		const birth = dto.facts.find((f) => f.type === 'BIRT')!;
		expect(dto.factLocations[birth.id]!.latitude).toBeCloseTo(51.9);
		// The unlocated death still shows in the facts list.
		expect(dto.facts.map((f) => f.type)).toContain('DEAT');
	});

	it('leaves a living person’s residence and census off the map but keeps their facts', async () => {
		const dto = await page('owner', 'dana');
		expect(await mappedTypes('owner', 'dana')).toEqual(['BIRT']);
		expect(dto.facts.map((f) => f.type).sort()).toEqual(['BIRT', 'CENS', 'RESI']);
		expect(JSON.stringify(dto.factLocations)).not.toMatch(/42\.88|"latitude":10/);
	});

	it('gives a restricted viewer no location for a person they may not see', async () => {
		// Dana is living, so hidden from a viewer: a throw or an empty map both leak nothing.
		const dto = await page('viewer', 'dana').catch(() => null);
		expect(dto === null || Object.keys(dto.factLocations).length === 0).toBe(true);
		expect(await mappedTypes('viewer', 'alice')).toEqual(['BIRT', 'RESI']);
	});
});
