import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { individuals } from '../db/schema';
import { importGedcomToDb } from '../testing/gedcom';
import { addTestMember, createTestDatabase, createTestTree, createTestUser } from '../testing/d1';
import type { TestActor, TestDatabase } from '../testing/d1';
import { FactService } from './fact-service';
import { MemberService } from './member-service';
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

const searchIds = async (treeId: string, text: string, who: TestActor) =>
	(await new SearchService(t.db).search(treeId, { text }, who.context)).people.map((p) => p.id);

async function setupGrant(role: 'viewer' | 'contributor') {
	const owner = await createTestUser(t.db);
	const treeId = await createTestTree(t.db, owner);
	await importGedcomToDb(t.d1, treeId, FIXTURE, 'Grant');
	const guest = await createTestUser(t.db);
	await addTestMember(t.db, treeId, guest, role);
	return { treeId, owner, guest, muma: await idOf(treeId, 'Muma') };
}

describe('a manager lets a viewer or contributor read private people (ADR-015)', () => {
	it('shows a granted viewer the living, and withdraws it again', async () => {
		const s = await setupGrant('viewer');
		const members = new MemberService(t.db);
		expect(await searchIds(s.treeId, 'Selfton', s.guest)).toEqual([]);
		await members.setCanSeePrivate(s.treeId, s.guest.userId, true, s.owner.context);
		expect(await searchIds(s.treeId, 'Selfton', s.guest)).toHaveLength(2);
		expect((await new TreeService(t.db).visiblePerson(s.treeId, s.muma, s.guest.context))?.id).toBe(
			s.muma
		);
		await members.setCanSeePrivate(s.treeId, s.guest.userId, false, s.owner.context);
		expect(await searchIds(s.treeId, 'Selfton', s.guest)).toEqual([]);
	});

	it('still refuses a granted contributor a write that touches a private person', async () => {
		const s = await setupGrant('contributor');
		await new MemberService(t.db).setCanSeePrivate(s.treeId, s.guest.userId, true, s.owner.context);
		const fact = {
			type: 'OCCU',
			dateText: null,
			place: null,
			value: 'Baker',
			cause: null,
			age: null,
			notes: null
		} as never;
		await expect(
			new FactService(t.db).create(s.treeId, s.muma, fact, s.guest.context)
		).rejects.toThrow();
	});

	it('is the owner or manager only, and only for a viewer or contributor', async () => {
		const s = await setupGrant('viewer');
		const members = new MemberService(t.db);
		await expect(
			members.setCanSeePrivate(s.treeId, s.guest.userId, true, s.guest.context)
		).rejects.toThrow();
		const editor = await createTestUser(t.db);
		await addTestMember(t.db, s.treeId, editor, 'editor');
		await expect(
			members.setCanSeePrivate(s.treeId, editor.userId, true, s.owner.context)
		).rejects.toThrow();
	});
});
