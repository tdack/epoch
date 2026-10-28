import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { individuals } from '../db/schema';
import { TreeRepository } from '../repositories/tree-repository';
import { importGedcomToDb } from '../testing/gedcom';
import { addTestMember, createTestDatabase, createTestTree, createTestUser } from '../testing/d1';
import type { TestDatabase } from '../testing/d1';
import { MemberService } from './member-service';
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
	await importGedcomToDb(t.d1, treeId, FIXTURE, 'Me');
	const viewer = await createTestUser(t.db);
	await addTestMember(t.db, treeId, viewer, 'viewer');
	const otherTree = await createTestTree(t.db, owner);
	return { treeId, otherTree, owner, viewer, service: new TreeService(t.db) };
}
const selfOf = async (treeId: string, user: { context: { user: { id: string } } }) =>
	(await new TreeRepository(t.db).listForUser(user.context.user.id)).find((r) => r.id === treeId)!
		.selfPersonId;

describe('a member’s own person', () => {
	it('sets, names and clears it, for that member alone', async () => {
		const s = await setup();
		const olda = await idOf(s.treeId, 'Olda');
		const saved = await s.service.setSelfPerson(s.treeId, olda, s.viewer.context);
		expect(saved.selfPersonId).toBe(olda);
		expect(await selfOf(s.treeId, s.viewer)).toBe(olda);
		expect(await selfOf(s.treeId, s.owner)).toBeNull();
		expect(await s.service.selfPersonNames(s.viewer.context)).toEqual({
			[s.treeId]: saved.selfPersonName
		});
		expect(await s.service.selfPersonNames(s.owner.context)).toEqual({});
		expect((await s.service.selfPerson(s.treeId, s.viewer.context))?.id).toBe(olda);
		await s.service.setSelfPerson(s.treeId, null, s.viewer.context);
		expect(await selfOf(s.treeId, s.viewer)).toBeNull();
	});

	it('refuses a person from another tree or one the viewer cannot see', async () => {
		const s = await setup();
		const olda = await idOf(s.treeId, 'Olda');
		await expect(s.service.setSelfPerson(s.otherTree, olda, s.owner.context)).rejects.toThrow();
		const hidden = await idOf(s.treeId, 'Dateless');
		await expect(s.service.setSelfPerson(s.treeId, hidden, s.viewer.context)).rejects.toThrow();
		await expect(s.service.setSelfPerson(s.treeId, hidden, s.owner.context)).resolves.toBeTruthy();
	});

	it('is not in the members list another member reads', async () => {
		const s = await setup();
		await s.service.setSelfPerson(s.treeId, await idOf(s.treeId, 'Olda'), s.viewer.context);
		const members = await new MemberService(t.db).list(s.treeId, s.owner.context);
		expect(JSON.stringify(members)).not.toMatch(/self|Olda/i);
	});

	it('names a person for the reports only when the caller may see them', async () => {
		const s = await setup();
		const olda = await idOf(s.treeId, 'Olda');
		const hidden = await idOf(s.treeId, 'Dateless');
		expect(await s.service.visiblePerson(s.treeId, olda, s.viewer.context)).toEqual({
			id: olda,
			name: expect.any(String)
		});
		expect(await s.service.visiblePerson(s.treeId, hidden, s.viewer.context)).toBeNull();
		expect(await s.service.visiblePerson(s.treeId, 'missing', s.viewer.context)).toBeNull();
	});
});
