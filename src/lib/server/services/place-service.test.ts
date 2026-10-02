/** Places over a real database: grouping, paging, and what a restricted viewer may learn from them. */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NotFoundError } from '../domain/errors';
import type { TreeRole } from '../domain/identity';
import { importGedcomToDb } from '../gedcom/importer';
import {
	addTestMember,
	createTestDatabase,
	createTestTree,
	createTestUser,
	type TestActor,
	type TestDatabase
} from '../testing/d1';
import { PlaceService } from './place-service';

const FIXTURE = `0 HEAD
0 @I1@ INDI
1 NAME Alice /Dead/
1 BIRT
2 DATE 1850
2 PLAC Cork, Ireland
1 FAMS @F1@
0 @I2@ INDI
1 NAME Bob /Dead/
1 BIRT
2 DATE 1848
2 PLAC cork, ireland
1 FAMS @F1@
1 FAMS @F2@
0 @I3@ INDI
1 NAME Carl /Dead/
1 BIRT
2 DATE 1860
2 PLAC Hobart, Tasmania
1 DEAT
2 DATE 1930
2 PLAC 100% Hobart_Town
0 @I4@ INDI
1 NAME Livia /Aliveson/
1 BIRT
2 DATE 1990
2 PLAC Perthville
1 FAMS @F2@
0 @F1@ FAM
1 HUSB @I2@
1 WIFE @I1@
1 MARR
2 DATE 1875
2 PLAC Chapelton
0 @F2@ FAM
1 HUSB @I2@
1 WIFE @I4@
1 MARR
2 DATE 1990
2 PLAC Secretstown
0 TRLR`;

const NOW = new Date('2026-10-01T12:00:00Z');
let t: TestDatabase;
let treeId: string;
const actors = {} as Record<TreeRole, TestActor>;
const places = () => new PlaceService(t.db, () => NOW);
const names = async (who: TreeRole, q = '') =>
	(await places().list(treeId, { q, limit: 100 }, actors[who].context)).items.map((p) => p.name);

beforeAll(async () => {
	t = await createTestDatabase();
	actors.owner = await createTestUser(t.db, 'owner');
	treeId = await createTestTree(t.db, actors.owner);
	for (const role of ['contributor', 'viewer'] as const) {
		actors[role] = await createTestUser(t.db, role);
		await addTestMember(t.db, treeId, actors[role], role);
	}
	await importGedcomToDb(t.d1, treeId, FIXTURE, 'Places');
}, 60_000);
afterAll(async () => {
	await t.dispose();
});

describe('for someone who sees everyone', () => {
	it('lists every place once, whatever the case, in order, with counts', async () => {
		const page = await places().list(treeId, {}, actors.owner.context);
		expect(page.items.map((p) => p.name)).toEqual([
			'100% Hobart_Town',
			'Chapelton',
			'Cork, Ireland',
			'Hobart, Tasmania',
			'Perthville',
			'Secretstown'
		]);
		expect(page.items.find((p) => p.name === 'Cork, Ireland')).toMatchObject({
			facts: 2,
			people: 2
		});
		// A partnership's fact is a fact and not a person.
		expect(page.items.find((p) => p.name === 'Chapelton')).toMatchObject({ facts: 1, people: 0 });
	});
	it('finds places by a substring, treats % and _ as text, and pages', async () => {
		expect(await names('owner', 'ire')).toEqual(['Cork, Ireland']);
		expect(await names('owner', '100%')).toEqual(['100% Hobart_Town']);
		expect(await names('owner', '%')).toEqual(['100% Hobart_Town']);
		expect(await names('owner', 'Hobart_')).toEqual(['100% Hobart_Town']);
		const first = await places().list(treeId, { limit: 2 }, actors.owner.context);
		expect(first.items).toHaveLength(2);
		expect(first.hasMore).toBe(true);
		const last = await places().list(treeId, { limit: 2, offset: 4 }, actors.owner.context);
		expect(last.items.map((p) => p.name)).toEqual(['Perthville', 'Secretstown']);
		expect(last.hasMore).toBe(false);
	});
	it('lists the facts at a place, in date order, whichever case it is asked for in', async () => {
		const dto = await places().detail(treeId, 'CORK, IRELAND', {}, actors.owner.context);
		expect(dto.facts.map((f) => [f.label, f.dateText, f.entityName])).toEqual([
			['Birth', '1848', 'Bob Dead'],
			['Birth', '1850', 'Alice Dead']
		]);
		const marriage = await places().detail(treeId, 'Chapelton', {}, actors.owner.context);
		expect(marriage.facts[0]).toMatchObject({
			kind: 'partnership',
			entityName: 'Alice Dead & Bob Dead',
			label: 'Marriage'
		});
	});
	it('answers a page past the end as not found, not as a crash', async () => {
		await expect(
			places().detail(treeId, 'Chapelton', { offset: 50 }, actors.owner.context)
		).rejects.toBeInstanceOf(NotFoundError);
	});
	it('answers an unknown place as not found', async () => {
		await expect(
			places().detail(treeId, 'Atlantis', {}, actors.owner.context)
		).rejects.toBeInstanceOf(NotFoundError);
	});
});

describe.each(['viewer', 'contributor'] as const)('for a %s', (role) => {
	it('leaves out a place only a private person, or a couple with a private partner, gives', async () => {
		expect(await names(role)).toEqual([
			'100% Hobart_Town',
			'Chapelton',
			'Cork, Ireland',
			'Hobart, Tasmania'
		]);
		expect(await names(role, 'perth')).toEqual([]);
		expect(await names(role, 'secret')).toEqual([]);
	});
	it('answers such a place as one nobody wrote', async () => {
		for (const place of ['Perthville', 'Secretstown']) {
			const hidden = await places()
				.detail(treeId, place, {}, actors[role].context)
				.catch((e) => e);
			const missing = await places()
				.detail(treeId, 'Atlantis', {}, actors[role].context)
				.catch((e) => e);
			expect(hidden).toBeInstanceOf(NotFoundError);
			expect(hidden.message.replace(place, 'X')).toBe(missing.message.replace('Atlantis', 'X'));
		}
	});
	it('counts and lists only what they may see at a shared place', async () => {
		// Bob's marriage to Livia is at Secretstown; his own birth at Cork is visible.
		const cork = await places().detail(treeId, 'Cork, Ireland', {}, actors[role].context);
		expect(cork.facts).toHaveLength(2);
		expect(
			JSON.stringify(await places().list(treeId, { limit: 100 }, actors[role].context))
		).not.toMatch(/Perthville|Secretstown|Livia/);
	});
});
