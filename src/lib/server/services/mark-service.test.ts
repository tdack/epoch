import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { trees, personMarks } from '../db/schema';
import { importGedcomToDb } from '../gedcom/importer';
import { NotFoundError, UnauthorizedError } from '../domain/errors';
import { MAX_RECENTS } from '../../shared/marks';
import { addTestMember, createTestDatabase, createTestTree, createTestUser, type TestActor, type TestDatabase } from '../testing/d1';
import { MarkService } from './mark-service';

let t: TestDatabase;
let alice: TestActor;
let bob: TestActor;
let treeId: string;
let otherTree: string;
let clock = 1_000;
let service: MarkService;

// Deceased, so a viewer may see them; a person with no facts is private to one (ADR-015).
const INDIS = Array.from({ length: MAX_RECENTS + 5 }, (_, i) => `0 @I${i}@ INDI\n1 NAME P${i} /Person/\n1 DEAT`).join('\n');
const FIXTURE = `0 HEAD\n${INDIS}\n0 TRLR`;
const id = (n: number, tree = treeId) => `${tree}:@I${n}@`;

beforeAll(async () => {
	t = await createTestDatabase();
	alice = await createTestUser(t.db, 'alice');
	bob = await createTestUser(t.db, 'bob');
	treeId = await createTestTree(t.db, alice);
	await addTestMember(t.db, treeId, bob, 'viewer');
	otherTree = await createTestTree(t.db, alice);
	await importGedcomToDb(t.d1, treeId, FIXTURE, 'Marks');
	await importGedcomToDb(t.d1, otherTree, FIXTURE, 'Marks2');
	service = new MarkService(t.db, () => ++clock);
}, 60_000);
afterAll(async () => {
	await t.dispose();
});

describe('favourites and recents', () => {
	it('keeps each user’s and each tree’s marks apart, newest first', async () => {
		await service.recordRecent(treeId, id(1), alice.context);
		await service.recordRecent(treeId, id(2), alice.context);
		await service.recordRecent(treeId, id(1), alice.context);
		await service.addFavorite(treeId, id(3), alice.context);
		await service.recordRecent(otherTree, id(4, otherTree), alice.context);
		await service.recordRecent(treeId, id(5), bob.context);

		const mine = await service.get(treeId, alice.context);
		expect(mine.recents.map((p) => p.id)).toEqual([id(1), id(2)]);
		expect(mine.favorites.map((p) => p.id)).toEqual([id(3)]);
		expect(mine.recents[0]).toMatchObject({ displayName: 'P1 Person', isPrivate: false });
		expect((await service.get(treeId, bob.context)).recents.map((p) => p.id)).toEqual([id(5)]);
		expect((await service.get(otherTree, alice.context)).recents.map((p) => p.id)).toEqual([id(4, otherTree)]);
	});

	it('favourites and unfavourites idempotently, and a viewer may', async () => {
		await service.addFavorite(treeId, id(6), bob.context);
		await service.addFavorite(treeId, id(6), bob.context);
		expect((await service.get(treeId, bob.context)).favorites.map((p) => p.id)).toEqual([id(6)]);
		await service.removeFavorite(treeId, id(6), bob.context);
		await service.removeFavorite(treeId, id(6), bob.context);
		expect((await service.get(treeId, bob.context)).favorites).toEqual([]);
	});

	it('keeps only the newest recents', async () => {
		const carol = await createTestUser(t.db, 'carol');
		await addTestMember(t.db, treeId, carol, 'viewer');
		for (let i = 0; i < MAX_RECENTS + 3; i++) await service.recordRecent(treeId, id(i), carol.context);
		const recents = (await service.get(treeId, carol.context)).recents;
		expect(recents).toHaveLength(MAX_RECENTS);
		expect(recents[0]!.id).toBe(id(MAX_RECENTS + 2));
	});

	it('skips a person who is gone and shows them again when they return', async () => {
		await service.addFavorite(treeId, id(7), alice.context);
		await t.d1.prepare('update individuals set tree_id = ? where id = ?').bind(otherTree, id(7)).run();
		expect((await service.get(treeId, alice.context)).favorites.map((p) => p.id)).not.toContain(id(7));
		await t.d1.prepare('update individuals set tree_id = ? where id = ?').bind(treeId, id(7)).run();
		expect((await service.get(treeId, alice.context)).favorites.map((p) => p.id)).toContain(id(7));
	});

	it('refuses a person from another tree, and a stranger', async () => {
		await expect(service.addFavorite(treeId, id(1, otherTree), alice.context)).rejects.toBeInstanceOf(NotFoundError);
		const stranger = await createTestUser(t.db, 'stranger');
		await expect(service.get(treeId, stranger.context)).rejects.toBeInstanceOf(UnauthorizedError);
	});

	it('goes with the tree and with the user', async () => {
		const temp = await createTestTree(t.db, alice);
		await importGedcomToDb(t.d1, temp, FIXTURE, 'Temp');
		await service.addFavorite(temp, id(1, temp), alice.context);
		await t.db.delete(trees).where(eq(trees.id, temp));
		expect(await t.db.select().from(personMarks).where(eq(personMarks.treeId, temp)).all()).toEqual([]);
	});
});
