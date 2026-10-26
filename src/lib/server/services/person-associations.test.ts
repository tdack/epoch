/**
 * Associations on the person page, read from kept GEDCOM lines over a real database: both people
 * see one, whether it was recorded on a person or a fact, and nobody hidden is named.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { individuals } from '../db/schema';
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

/** Ann's christening names godparents Bob and Cat (living); Ann names Dan a friend and @I9@, who is not in the file, a neighbour; Bob witnessed Eve and Fay's marriage. */
const FIXTURE = `0 HEAD
0 @I1@ INDI
1 NAME Ann /Ash/
1 BIRT
2 DATE 1 JAN 1900
1 CHR
2 DATE 7 JAN 1900
2 ASSO @I2@
3 RELA godfather
2 _ASSO @I3@
3 RELA godmother
1 ASSO @I4@
2 RELA friend
1 ASSO @I9@
2 RELA neighbour
1 DEAT
2 DATE 1970
0 @I2@ INDI
1 NAME Bob /Birch/
1 BIRT
2 DATE 1870
1 DEAT
2 DATE 1940
0 @I3@ INDI
1 NAME Cat /Cole/
1 BIRT
2 DATE 2001
0 @I4@ INDI
1 NAME Dan /Dee/
1 BIRT
2 DATE 1899
1 DEAT
2 DATE 1960
0 @I5@ INDI
1 NAME Eve /Elm/
1 BIRT
2 DATE 1880
1 DEAT
2 DATE 1950
1 FAMS @F1@
0 @I6@ INDI
1 NAME Fay /Fir/
1 BIRT
2 DATE 1882
1 DEAT
2 DATE 1951
1 FAMS @F1@
0 @F1@ FAM
1 HUSB @I5@
1 WIFE @I6@
1 MARR
2 DATE 1905
2 _ASSO @I2@
3 RELA witness
0 TRLR`;

let t: TestDatabase;
let owner: TestActor;
let viewer: TestActor;
let treeId: string;
const id = (xref: string) => `${treeId}:${xref}`;
const page = (xref: string, who = owner) =>
	new PersonPageService(t.db).getPerson(treeId, id(xref), who.context);
const shown = async (xref: string, who = owner) =>
	(await page(xref, who)).associations.map((a) => ({
		name: a.person.displayName,
		role: a.role,
		fact: a.factLabel,
		isNamedBy: a.isNamedBy
	}));

beforeAll(async () => {
	t = await createTestDatabase();
	owner = await createTestUser(t.db, 'owner');
	viewer = await createTestUser(t.db, 'viewer');
	treeId = await createTestTree(t.db, owner);
	await addTestMember(t.db, treeId, viewer, 'viewer');
	await importGedcomToDb(t.d1, treeId, FIXTURE, 'Associations');
}, 60_000);
afterAll(async () => {
	await t.dispose();
});

describe('associations on the person page', () => {
	it("lists the person's own: on their record and on their facts, skipping a pointer at nobody", async () => {
		expect(await shown('@I1@')).toEqual([
			{ name: 'Dan Dee', role: 'friend', fact: null, isNamedBy: false },
			{ name: 'Bob Birch', role: 'godfather', fact: 'Christening', isNamedBy: false },
			{ name: 'Cat Cole', role: 'godmother', fact: 'Christening', isNamedBy: false }
		]);
	});

	it("lists where someone else's record or fact names them, a partnership's for each partner", async () => {
		expect(await shown('@I2@')).toEqual([
			{ name: 'Ann Ash', role: 'godfather', fact: 'Christening', isNamedBy: true },
			{ name: 'Eve Elm', role: 'witness', fact: 'Marriage', isNamedBy: true },
			{ name: 'Fay Fir', role: 'witness', fact: 'Marriage', isNamedBy: true }
		]);
		expect(await shown('@I4@')).toEqual([
			{ name: 'Ann Ash', role: 'friend', fact: null, isNamedBy: true }
		]);
	});

	it('names nobody a restricted viewer may not see', async () => {
		expect((await shown('@I1@', viewer)).map((a) => a.name)).toEqual(['Dan Dee', 'Bob Birch']);
	});

	it('follows a pointer to the person a merge left its XREF on', async () => {
		await t.db
			.update(individuals)
			.set({ xrefAliases: ['@I9@'] })
			.where(and(eq(individuals.treeId, treeId), eq(individuals.id, id('@I4@'))));
		expect(await shown('@I1@')).toContainEqual({
			name: 'Dan Dee',
			role: 'neighbour',
			fact: null,
			isNamedBy: false
		});
		expect(await shown('@I4@')).toContainEqual({
			name: 'Ann Ash',
			role: 'neighbour',
			fact: null,
			isNamedBy: true
		});
	});
});
