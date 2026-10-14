import { eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { changeLog, individuals, personNames, sourceRepositories, sources } from '../db/schema';
import { importGedcomToDb } from '../testing/gedcom';
import { createTestDatabase, createTestUser, type TestDatabase } from '../testing/d1';
import { EvidenceRepository } from './evidence-repository';
import { GraphWindowRepository } from './graph-window-repository';

/**
 * The id-lookup helpers take the tree they serve, so an id from another tree finds nothing even when
 * a caller forgot to check first. Each test puts the same shape of record in two trees and asks one
 * tree for the other's id.
 */

let t: TestDatabase;
beforeAll(async () => {
	t = await createTestDatabase();
});
afterAll(async () => {
	await t.dispose();
});

const GED_ONE = `0 HEAD
0 @I1@ INDI
1 NAME Ann /One/
0 @I2@ INDI
1 NAME Bo /Two/
0 @S1@ SOUR
1 TITL Parish register
1 REPO @R1@
0 @R1@ REPO
1 NAME Parish office
0 TRLR`;

const GED_TWO = GED_ONE.replace('Ann /One/', 'Cy /Three/')
	.replace('Bo /Two/', 'Di /Four/')
	.replace('Parish register', 'Other register')
	.replace('Parish office', 'Other office');

async function twoTrees() {
	const [a, b] = [crypto.randomUUID(), crypto.randomUUID()];
	await importGedcomToDb(t.d1, a, GED_ONE, 'A');
	await importGedcomToDb(t.d1, b, GED_TWO, 'B');
	const people = async (treeId: string) =>
		(
			await t.db
				.select({ id: individuals.id })
				.from(individuals)
				.where(eq(individuals.treeId, treeId))
		).map((r) => r.id);
	const sourceIds = async (treeId: string) =>
		(await t.db.select({ id: sources.id }).from(sources).where(eq(sources.treeId, treeId))).map(
			(r) => r.id
		);
	const [peopleA, peopleB] = [await people(a), await people(b)];
	const [sourceA, sourceB] = [await sourceIds(a), await sourceIds(b)];
	return { a, b, peopleA, peopleB, sourceA, sourceB };
}

describe('namesOf is scoped to the tree it is given', () => {
	it('returns the names of this tree’s people, and nothing for another tree’s people', async () => {
		const { a, b, peopleA, peopleB } = await twoTrees();
		const repo = new GraphWindowRepository(t.db);

		const [own] = await repo.run(repo.namesOf(a, peopleA));
		expect(own.length).toBeGreaterThan(0);
		expect(own.every((r) => peopleA.includes(r.row.personId))).toBe(true);

		const [foreign] = await repo.run(repo.namesOf(a, peopleB));
		expect(foreign).toEqual([]);

		const [sameIdsOfB] = await repo.run(repo.namesOf(b, peopleB));
		expect(sameIdsOfB.length).toBeGreaterThan(0);
	});
});

describe('namesByIds is scoped to the tree it is given', () => {
	it('returns a name of this tree and not a name of another tree', async () => {
		const { a, peopleA, peopleB } = await twoTrees();
		const names = await t.db
			.select({ id: personNames.id, personId: personNames.personId })
			.from(personNames)
			.where(inArray(personNames.personId, [...peopleA, ...peopleB]));
		const nameIdsA = names.filter((n) => peopleA.includes(n.personId)).map((n) => n.id);
		const nameIdsB = names.filter((n) => peopleB.includes(n.personId)).map((n) => n.id);
		expect(nameIdsA.length).toBeGreaterThan(0);

		const evidence = new EvidenceRepository(t.db);
		expect((await evidence.namesByIds(a, nameIdsA)).map((n) => n.id).sort()).toEqual(
			[...nameIdsA].sort()
		);
		expect(await evidence.namesByIds(a, nameIdsB)).toEqual([]);
	});
});

describe('linksOfSource is scoped to the tree it is given', () => {
	it('does not name a repository of another tree linked to this tree’s source', async () => {
		const { a, b, sourceA, sourceB } = await twoTrees();
		const repoOfB = await t.db
			.select({ id: sourceRepositories.repositoryId })
			.from(sourceRepositories)
			.where(inArray(sourceRepositories.sourceId, sourceB));
		const foreignRepositoryId = repoOfB[0]!.id!;
		// A link in tree A's source that names tree B's repository: the case the join must refuse.
		await t.db.insert(sourceRepositories).values({
			id: crypto.randomUUID(),
			sourceId: sourceA[0]!,
			repositoryId: foreignRepositoryId,
			sortOrder: 99
		});

		const evidence = new EvidenceRepository(t.db);
		const links = await evidence.linksOfSource(a, sourceA[0]!);
		const foreign = links.find((l) => l.link.repositoryId === foreignRepositoryId);
		expect(foreign).toBeDefined();
		expect(foreign!.repository).toBeNull();

		const ownLinks = links.filter((l) => l.link.repositoryId !== foreignRepositoryId);
		expect(ownLinks.every((l) => l.repository?.treeId === a)).toBe(true);
		expect(ownLinks.length).toBeGreaterThan(0);

		// The source itself is not in tree B, so asking tree B for it returns nothing.
		expect(await evidence.linksOfSource(b, sourceA[0]!)).toEqual([]);
	});
});

describe('actorNames is scoped to the tree’s change history', () => {
	it('names a former member who edited this tree, and not a user whose edits are elsewhere', async () => {
		const { a, b } = await twoTrees();
		const former = await createTestUser(t.db, 'former');
		const elsewhere = await createTestUser(t.db, 'elsewhere');
		// Neither user is a member of tree A: the former member's edits must still be named there.
		for (const [treeId, actorId] of [
			[a, former.userId],
			[b, elsewhere.userId]
		] as const) {
			await t.db.insert(changeLog).values({
				id: crypto.randomUUID(),
				treeId,
				actorId,
				kind: 'update_person',
				summary: 'Edited a person',
				changesJson: '[]'
			});
		}

		const repo = new GraphWindowRepository(t.db);
		const names = await repo.actorNames(a, [former.userId, elsewhere.userId]);
		expect(names.get(former.userId)).toBe('former');
		expect(names.has(elsewhere.userId)).toBe(false);
	});
});

describe('chunked reads that carry the visibility fragment stay under the D1 parameter limit', () => {
	it('counts citations for more sources than one chunk, for a contributor', async () => {
		const treeA = crypto.randomUUID();
		const sourceIds = Array.from({ length: 120 }, (_, i) => `no-such-source-${i}`);
		// D1 refuses a statement with more than 100 bound parameters; a contributor's scope binds the
		// most, so this threw "too many SQL variables" when the chunk was 80 ids.
		await expect(
			new EvidenceRepository(t.db).visibleCitationCounts(treeA, sourceIds, {
				isRestricted: true,
				cutoff: '1906-10-01',
				creatorId: 'a-contributor'
			})
		).resolves.toBeInstanceOf(Map);
	});
});
