import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { individuals } from '../db/schema';
import { TreeRepository } from '../repositories/tree-repository';
import { importGedcomToDb } from '../testing/gedcom';
import { addTestMember, createTestDatabase, createTestTree, createTestUser } from '../testing/d1';
import type { TestDatabase } from '../testing/d1';
import { TreeService } from './tree-service';

const FIXTURE = `0 HEAD
0 @I1@ INDI
1 NAME Olda /Oldman/
1 BIRT
2 DATE 1850
0 @I2@ INDI
1 NAME Dateless /Person/
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
	await importGedcomToDb(t.d1, treeId, FIXTURE, 'Home');
	const viewer = await createTestUser(t.db);
	await addTestMember(t.db, treeId, viewer, 'viewer');
	const otherTree = await createTestTree(t.db, owner);
	return { treeId, otherTree, owner, viewer, service: new TreeService(t.db) };
}
const homeOf = async (treeId: string, user: { context: { user: { id: string } } }) =>
	(await new TreeRepository(t.db).listForUser(user.context.user.id)).find((r) => r.id === treeId)!
		.homePersonId;

describe('a member’s starting person', () => {
	it('sets, names and clears it, for that member alone', async () => {
		const s = await setup();
		const olda = await idOf(s.treeId, 'Olda');
		const saved = await s.service.setHomePerson(s.treeId, olda, s.viewer.context);
		expect(saved.homePersonId).toBe(olda);
		expect(saved.homePersonName).toContain('Olda');
		expect(await homeOf(s.treeId, s.viewer)).toBe(olda);
		expect(await homeOf(s.treeId, s.owner)).toBeNull();
		expect(await s.service.homePersonNames(s.viewer.context)).toEqual({
			[s.treeId]: saved.homePersonName
		});
		await s.service.setHomePerson(s.treeId, null, s.viewer.context);
		expect(await homeOf(s.treeId, s.viewer)).toBeNull();
	});

	it('refuses a person from another tree or one the viewer cannot see', async () => {
		const s = await setup();
		const olda = await idOf(s.treeId, 'Olda');
		await expect(s.service.setHomePerson(s.otherTree, olda, s.owner.context)).rejects.toThrow();
		const hidden = await idOf(s.treeId, 'Dateless');
		await expect(s.service.setHomePerson(s.treeId, hidden, s.viewer.context)).rejects.toThrow();
		// The owner sees everyone, so the same person is fine for them.
		await expect(s.service.setHomePerson(s.treeId, hidden, s.owner.context)).resolves.toBeTruthy();
	});

	it('drops a stale or no-longer-visible choice from the names', async () => {
		const s = await setup();
		await s.service.setHomePerson(s.treeId, await idOf(s.treeId, 'Dateless'), s.owner.context);
		await new TreeRepository(t.db).setMemberHomePerson(s.viewer.context.user.id, s.treeId, 'gone');
		expect(await s.service.homePersonNames(s.viewer.context)).toEqual({});
	});
});
