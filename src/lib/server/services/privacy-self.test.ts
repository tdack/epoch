import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { individuals } from '../db/schema';
import { importGedcomToDb } from '../testing/gedcom';
import { addTestMember, createTestDatabase, createTestTree, createTestUser } from '../testing/d1';
import type { TestActor, TestDatabase } from '../testing/d1';
import { FactService } from './fact-service';
import { MemberService } from './member-service';
import { PersonPageService } from './person-page-service';
import { SearchService } from './search-service';
import { TreeService } from './tree-service';

// Mia and her mother are living, so hidden from a viewer; Olda is long dead.
const FIXTURE = `0 HEAD
0 @I1@ INDI
1 NAME Mia /Selfton/
1 BIRT
2 DATE 1990
1 FAMC @F1@
0 @I2@ INDI
1 NAME Muma /Selfton/
1 BIRT
2 DATE 1962
1 FAMS @F1@
0 @I3@ INDI
1 NAME Olda /Oldman/
1 BIRT
2 DATE 1850
0 @F1@ FAM
1 WIFE @I2@
1 CHIL @I1@
0 TRLR`;

let t: TestDatabase;
beforeAll(async () => {
	t = await createTestDatabase();
});
afterAll(async () => {
	await t.dispose();
});

const idOf = async (treeId: string, givenName: string) =>
	(
		await t.db
			.select({ id: individuals.id })
			.from(individuals)
			.where(and(eq(individuals.treeId, treeId), eq(individuals.givenName, givenName)))
	)[0]!.id;

async function setup() {
	const owner = await createTestUser(t.db);
	const treeId = await createTestTree(t.db, owner);
	await importGedcomToDb(t.d1, treeId, FIXTURE, 'Self');
	const mia = await createTestUser(t.db);
	await addTestMember(t.db, treeId, mia, 'viewer');
	const other = await createTestUser(t.db);
	await addTestMember(t.db, treeId, other, 'contributor');
	const ids = {
		mia: await idOf(treeId, 'Mia'),
		muma: await idOf(treeId, 'Muma'),
		olda: await idOf(treeId, 'Olda')
	};
	await new MemberService(t.db).setPerson(treeId, mia.userId, ids.mia, owner.context);
	return { treeId, owner, mia, other, ids };
}

const searchIds = async (treeId: string, text: string, who: TestActor) =>
	(await new SearchService(t.db).search(treeId, { text }, who.context)).people.map((p) => p.id);

describe('a member always sees their own person (ADR-015, amended 2026-11-06)', () => {
	it('shows a viewer their own living record, and nobody else theirs', async () => {
		const s = await setup();
		const trees = new TreeService(t.db);
		expect(await trees.selfPerson(s.treeId, s.mia.context)).toEqual({
			id: s.ids.mia,
			name: expect.stringMatching(/Mia/)
		});
		const page = await new PersonPageService(t.db).getPerson(s.treeId, s.ids.mia, s.mia.context);
		expect(JSON.stringify(page)).toContain('Mia');
		expect(await searchIds(s.treeId, 'Selfton', s.mia)).toEqual([s.ids.mia]);

		// The rule is about the member's own record, not a door to the rest of their living family.
		expect(await trees.visiblePerson(s.treeId, s.ids.muma, s.mia.context)).toBeNull();
		expect(JSON.stringify(page)).not.toContain('Muma');
		await expect(
			new PersonPageService(t.db).getPerson(s.treeId, s.ids.muma, s.mia.context)
		).rejects.toThrow();

		expect(await trees.visiblePerson(s.treeId, s.ids.mia, s.other.context)).toBeNull();
		expect(await searchIds(s.treeId, 'Selfton', s.other)).toEqual([]);
	});

	it('holds when the person is marked private', async () => {
		const s = await setup();
		await t.db.update(individuals).set({ privacy: 'private' }).where(eq(individuals.id, s.ids.mia));
		expect(
			(await new TreeService(t.db).visiblePerson(s.treeId, s.ids.mia, s.mia.context))?.id
		).toBe(s.ids.mia);
		expect(await searchIds(s.treeId, 'Selfton', s.mia)).toEqual([s.ids.mia]);
	});

	it('ends when the link is cleared or moved', async () => {
		const s = await setup();
		const members = new MemberService(t.db);
		await members.setPerson(s.treeId, s.mia.userId, s.ids.olda, s.owner.context);
		expect(
			await new TreeService(t.db).visiblePerson(s.treeId, s.ids.mia, s.mia.context)
		).toBeNull();
		await members.setPerson(s.treeId, s.mia.userId, null, s.owner.context);
		expect(await searchIds(s.treeId, 'Selfton', s.mia)).toEqual([]);
	});

	it('lets a member move their own link only to someone they can see', async () => {
		const s = await setup();
		const trees = new TreeService(t.db);
		await expect(trees.setSelfPerson(s.treeId, s.ids.muma, s.mia.context)).rejects.toThrow();
		await expect(trees.setSelfPerson(s.treeId, s.ids.mia, s.mia.context)).resolves.toBeTruthy();
	});

	it('sees but does not edit it: seeing a record grants no write', async () => {
		const owner = await createTestUser(t.db);
		const treeId = await createTestTree(t.db, owner);
		await importGedcomToDb(t.d1, treeId, FIXTURE, 'Self');
		const mia = await createTestUser(t.db);
		await addTestMember(t.db, treeId, mia, 'contributor');
		const id = await idOf(treeId, 'Mia');
		await new MemberService(t.db).setPerson(treeId, mia.userId, id, owner.context);
		expect((await new TreeService(t.db).visiblePerson(treeId, id, mia.context))?.id).toBe(id);
		const fact = {
			type: 'OCCU',
			dateText: null,
			place: null,
			value: 'Baker',
			cause: null,
			age: null,
			notes: null
		} as never;
		await expect(new FactService(t.db).create(treeId, id, fact, mia.context)).rejects.toThrow();
	});
});
