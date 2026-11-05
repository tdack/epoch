/**
 * Who may say which person a member is (ADR-075): anyone for themself, and otherwise only those
 * who may manage that member. The members screen offers what this allows; these tests hold the server to it.
 */

import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { changeLog, individuals, treeMemberships } from '../db/schema';
import { UnauthorizedError, ValidationError } from '../domain/errors';
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
import { MemberService } from './member-service';

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
}, 60_000);
afterAll(async () => {
	await t.dispose();
});

type Who = TreeRole | 'manager2';
const ROLES = ['owner', 'manager', 'manager2', 'editor', 'contributor', 'viewer'] as const;

async function tree() {
	const actors = {} as Record<Who, TestActor>;
	actors.owner = await createTestUser(t.db, 'owner');
	const treeId = await createTestTree(t.db, actors.owner);
	for (const who of ROLES.slice(1)) {
		actors[who] = await createTestUser(t.db, who);
		await addTestMember(t.db, treeId, actors[who], who === 'manager2' ? 'manager' : who);
	}
	await importGedcomToDb(t.d1, treeId, FIXTURE, 'People');
	const idOf = async (givenName: string) =>
		(
			await t.db
				.select({ id: individuals.id })
				.from(individuals)
				.where(and(eq(individuals.treeId, treeId), eq(individuals.givenName, givenName)))
		)[0]!.id;
	return { treeId, actors, olda: await idOf('Olda'), hidden: await idOf('Dateless') };
}

const personOf = async (treeId: string, actor: TestActor) =>
	(
		await t.db
			.select({ id: treeMemberships.selfPersonId })
			.from(treeMemberships)
			.where(and(eq(treeMemberships.treeId, treeId), eq(treeMemberships.userId, actor.userId)))
	)[0]?.id ?? null;

/** Who each caller may set the person of; everyone else must be refused. */
const ALLOWED: Record<Who, readonly Who[]> = {
	owner: ROLES,
	manager: ['manager', 'editor', 'contributor', 'viewer'],
	manager2: ['manager2', 'editor', 'contributor', 'viewer'],
	editor: ['editor'],
	contributor: ['contributor'],
	viewer: ['viewer']
};

describe('the permission matrix', () => {
	const cases = ROLES.flatMap((by) =>
		ROLES.map((of) => [by, of, ALLOWED[by].includes(of)] as const)
	);

	it.each(cases)('%s setting and clearing %s: allowed %s', async (by, of, isAllowed) => {
		const s = await tree();
		const set = (personId: string | null) =>
			new MemberService(t.db).setPerson(
				s.treeId,
				s.actors[of].userId,
				personId,
				s.actors[by].context
			);
		if (isAllowed) {
			await set(s.olda);
			expect(await personOf(s.treeId, s.actors[of])).toBe(s.olda);
			await set(null);
			expect(await personOf(s.treeId, s.actors[of])).toBeNull();
		} else {
			await expect(set(s.olda)).rejects.toBeInstanceOf(UnauthorizedError);
			await expect(set(null)).rejects.toBeInstanceOf(UnauthorizedError);
			expect(await personOf(s.treeId, s.actors[of])).toBeNull();
		}
	});
});

describe('setting a member’s person', () => {
	it('refuses someone outside the tree and the public visitor', async () => {
		const s = await tree();
		const stranger = await createTestUser(t.db, 'stranger');
		const target = s.actors.viewer.userId;
		await expect(
			new MemberService(t.db).setPerson(s.treeId, target, s.olda, stranger.context)
		).rejects.toBeInstanceOf(UnauthorizedError);
		const visitor = {
			...s.actors.owner.context,
			user: { ...s.actors.owner.context.user, isPublicVisitor: true }
		};
		await expect(
			new MemberService(t.db).setPerson(s.treeId, target, s.olda, visitor)
		).rejects.toBeInstanceOf(UnauthorizedError);
	});

	it('refuses a person from another tree, and one the caller cannot see, as missing', async () => {
		const s = await tree();
		const other = await tree();
		const service = new MemberService(t.db);
		await expect(
			service.setPerson(s.treeId, s.actors.viewer.userId, other.olda, s.actors.owner.context)
		).rejects.toBeInstanceOf(ValidationError);
		// A living person with no dates is hidden from a viewer, so they cannot claim to be them.
		await expect(
			service.setPerson(s.treeId, s.actors.viewer.userId, s.hidden, s.actors.viewer.context)
		).rejects.toBeInstanceOf(ValidationError);
		await service.setPerson(s.treeId, s.actors.viewer.userId, s.hidden, s.actors.owner.context);
		expect(await personOf(s.treeId, s.actors.viewer)).toBe(s.hidden);
	});

	it('logs a change to someone else, naming the member but not the person', async () => {
		const s = await tree();
		const service = new MemberService(t.db);
		await service.setPerson(s.treeId, s.actors.owner.userId, s.olda, s.actors.owner.context);
		await service.setPerson(s.treeId, s.actors.viewer.userId, s.olda, s.actors.manager.context);
		// Picking the same person again changes nothing worth logging.
		await service.setPerson(s.treeId, s.actors.viewer.userId, s.olda, s.actors.owner.context);
		const logged = await t.db
			.select({ kind: changeLog.kind, summary: changeLog.summary })
			.from(changeLog)
			.where(and(eq(changeLog.treeId, s.treeId), eq(changeLog.kind, 'set_member_person')));
		expect(logged).toEqual([{ kind: 'set_member_person', summary: 'Set which person viewer is' }]);
	});

	it('lists each member’s person and whether the caller may change it', async () => {
		const s = await tree();
		const service = new MemberService(t.db);
		await service.setPerson(s.treeId, s.actors.editor.userId, s.olda, s.actors.editor.context);
		const listed = await service.list(s.treeId, s.actors.manager.context);
		const row = (who: Who) => listed.members.find((m) => m.userId === s.actors[who].userId)!;
		expect(row('editor').person).toEqual({ id: s.olda, name: expect.stringMatching(/Olda/) });
		expect(row('viewer').person).toBeNull();
		expect(row('manager').canSetPerson).toBe(true);
		expect(row('manager2').canSetPerson).toBe(false);
		expect(row('owner').canSetPerson).toBe(false);
		expect(row('viewer').canSetPerson).toBe(true);
		expect(listed.members.some((m) => 'selfPersonId' in m)).toBe(false);
	});
});
