/**
 * The one public tree (ADR-041): who may publish it, that the database allows only one, and that a
 * reader nobody identified sees every person who is not marked private and can change nothing.
 */

import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { individuals, trees } from '../db/schema';
import { PUBLIC_VISITOR, type AuthenticatedContext } from '../domain/identity';
import { EVERYONE_SHOWN_CUTOFF, isPersonPrivate } from '../domain/living-state';
import { visibleAmong } from '../repositories/visibility';
import { importGedcomToDb } from '../testing/gedcom';
import {
	addTestMember,
	createTestDatabase,
	createTestTree,
	createTestUser,
	type TestActor,
	type TestDatabase
} from '../testing/d1';
import { ListService } from './list-service';
import { MarkService } from './mark-service';
import { MutationRunner } from './mutation-runner';
import { MemberService } from './member-service';
import { PrivacyService } from './privacy-service';
import { PublicTreeService } from './public-tree-service';
import { QualityService } from './quality-service';
import { TaskReadService } from './task-read-service';
import { requireTreeScope } from './tree-access';
import { TreeRepository } from '../repositories/tree-repository';
import { UserRepository } from '../repositories/user-repository';
import { TreeService } from './tree-service';
import { GedcomService } from './gedcom-service';
import { buildExportInstanceId } from '../workflows/export-instance';

const NOW = new Date('2026-10-01T12:00:00Z');

const FIXTURE = `0 HEAD
0 @I1@ INDI
1 NAME Liv /Livingston/
1 BIRT
2 DATE 1985
0 @I2@ INDI
1 NAME Noel /Nofacts/
0 @I3@ INDI
1 NAME Riley /Privateforced/
1 BIRT
2 DATE 1900
0 @I4@ INDI
1 NAME Old /Oldfield/
1 DEAT
0 TRLR`;

let t: TestDatabase;
let installOwner: TestActor;
let ownerCtx: AuthenticatedContext;
let member: TestActor;
let stranger: TestActor;
let firstId: string;
let secondId: string;
let firstName: string;
let secondName: string;
const visitorCtx: AuthenticatedContext = { user: PUBLIC_VISITOR, correlationId: 'public' };
let idOf: (xref: string) => string;

const service = () => new PublicTreeService(t.db, () => NOW);
const nameOf = async (id: string) =>
	(await t.db.select({ name: trees.name }).from(trees).where(eq(trees.id, id)))[0]!.name;

beforeAll(async () => {
	t = await createTestDatabase();
	installOwner = await createTestUser(t.db, 'install-owner');
	ownerCtx = {
		...installOwner.context,
		user: { ...installOwner.context.user, isInstallOwner: true }
	};
	member = await createTestUser(t.db, 'member');
	stranger = await createTestUser(t.db, 'stranger');
	firstId = await createTestTree(t.db, member);
	secondId = await createTestTree(t.db, member);
	await addTestMember(t.db, firstId, await createTestUser(t.db, 'a-viewer'), 'viewer');
	await importGedcomToDb(t.d1, firstId, FIXTURE, 'Royal demo');
	firstName = await nameOf(firstId);
	secondName = await nameOf(secondId);
	const rows = await t.db
		.select({ id: individuals.id, xref: individuals.xrefId })
		.from(individuals)
		.where(eq(individuals.treeId, firstId));
	const byXref = new Map(rows.map((r) => [r.xref, r.id]));
	idOf = (x) => byXref.get(x)!;
	await t.db
		.update(individuals)
		.set({ privacy: 'private' })
		.where(eq(individuals.id, idOf('@I3@')));
}, 60_000);
afterAll(async () => {
	await t.dispose();
});

describe('who may publish', () => {
	it('refuses everyone but the install owner, with a 403', async () => {
		for (const ctx of [member.context, visitorCtx]) {
			await expect(service().setPublicTree(firstId, firstName, ctx)).rejects.toMatchObject({
				status: 403
			});
			await expect(service().listAll(ctx)).rejects.toMatchObject({ status: 403 });
		}
	});

	it('refuses a wrong confirmation, and nothing becomes public', async () => {
		await expect(service().setPublicTree(firstId, 'royal demo', ownerCtx)).rejects.toMatchObject({
			code: 'VALIDATION_ERROR'
		});
		await expect(service().current()).resolves.toBeNull();
	});
});

describe('publishing', () => {
	it('makes a tree public with a time and a publisher, and ends anonymous access when withdrawn', async () => {
		const { publicTree } = await service().setPublicTree(firstId, firstName, ownerCtx);
		expect(publicTree).toMatchObject({ id: firstId, name: firstName });
		const row = (await t.db.select().from(trees).where(eq(trees.id, firstId)))[0]!;
		expect(row.publishedBy).toBe(installOwner.userId);
		expect(row.publicSince).toEqual(NOW);

		const users = new UserRepository(t.db);
		const scope = () =>
			requireTreeScope(users, new TreeRepository(t.db), firstId, visitorCtx, 'tree:view', NOW);
		await expect(scope()).resolves.toMatchObject({ role: 'viewer', isOutsider: true });

		// Withdrawing needs the name of the tree that is public, not any tree.
		await expect(service().setPublicTree(null, secondName, ownerCtx)).rejects.toMatchObject({
			code: 'VALIDATION_ERROR'
		});
		await service().setPublicTree(null, firstName, ownerCtx);
		await expect(service().current()).resolves.toBeNull();
		await expect(scope()).rejects.toMatchObject({ status: 403 });
	});

	it('replaces the public tree in one step, and the index refuses a second', async () => {
		await service().setPublicTree(firstId, firstName, ownerCtx);
		await service().setPublicTree(secondId, secondName, ownerCtx);
		expect((await service().current())?.id).toBe(secondId);
		const flags = await t.db.select({ id: trees.id, isPublic: trees.isPublic }).from(trees);
		expect(flags.filter((f) => f.isPublic).map((f) => f.id)).toEqual([secondId]);

		await expect(
			t.db.update(trees).set({ isPublic: true }).where(eq(trees.id, firstId))
		).rejects.toThrow();
	});

	it('leaves the current public tree alone when the new tree is confirmed with the wrong name', async () => {
		await expect(service().setPublicTree(firstId, 'nope', ownerCtx)).rejects.toThrow();
		expect((await service().current())?.id).toBe(secondId);
	});

	it('lists every tree for the install owner, members or not', async () => {
		const all = await service().listAll(ownerCtx);
		expect(all.map((r) => r.id)).toEqual(expect.arrayContaining([firstId, secondId]));
		expect(all.find((r) => r.id === secondId)).toMatchObject({
			role: null,
			isPublic: true,
			memberCount: 1
		});
		expect(all.find((r) => r.id === firstId)).toMatchObject({ peopleCount: 4, memberCount: 2 });
	});
});

describe('the install owner and trees they are not in', () => {
	it('may rename and delete them; a stranger may not', async () => {
		const trees_ = new TreeService(t.db);
		const tree = await trees_.createTree('Other', null, member.context);
		await expect(
			trees_.updateTree(tree.id, 1, { name: 'x' }, stranger.context)
		).rejects.toMatchObject({
			status: 403
		});
		await expect(
			trees_.updateTree(tree.id, 1, { name: 'Renamed' }, ownerCtx)
		).resolves.toMatchObject({
			name: 'Renamed'
		});
		await expect(trees_.previewDeleteTree(tree.id, ownerCtx)).resolves.toBeDefined();
		await trees_.deleteTree(tree.id, ownerCtx);
		await expect(trees_.deleteTree(tree.id, ownerCtx)).rejects.toMatchObject({ status: 404 });
	});
});

describe('the public tree as a visitor sees it', () => {
	beforeAll(async () => {
		await service().setPublicTree(firstId, await nameOf(firstId), ownerCtx);
	});

	it('shows living people to everyone, but not a person marked private', async () => {
		const lists = new ListService(t.db, () => NOW);
		const viewer = await createTestUser(t.db, 'plain-viewer');
		await addTestMember(t.db, firstId, viewer, 'viewer');
		for (const ctx of [visitorCtx, stranger.context, viewer.context]) {
			const page = await lists.individuals(firstId, {}, ctx);
			const names = page.items.map((i) => i.displayName).join('|');
			expect(names).toContain('Livingston');
			expect(names).toContain('Nofacts');
			expect(names).not.toContain('Privateforced');
		}
	});

	it('is the same rule in SQL and in the pure function', async () => {
		const scope = { isRestricted: true, cutoff: EVERYONE_SHOWN_CUTOFF, creatorId: null };
		const ids = ['@I1@', '@I2@', '@I3@', '@I4@'].map(idOf);
		const visible = await visibleAmong(t.db, firstId, ids, scope);
		for (const xref of ['@I1@', '@I2@', '@I3@', '@I4@']) {
			const person = (
				await t.db
					.select()
					.from(individuals)
					.where(eq(individuals.id, idOf(xref)))
			)[0]!;
			expect(visible.has(idOf(xref)), xref).toBe(
				!isPersonPrivate(person.privacy, [], EVERYONE_SHOWN_CUTOFF)
			);
		}
		expect([...visible].sort()).toEqual([idOf('@I1@'), idOf('@I2@'), idOf('@I4@')].sort());
	});

	it('refuses a tree that is not public exactly as it refuses a stranger', async () => {
		const lists = new ListService(t.db, () => NOW);
		const other = await createTestTree(t.db, member);
		const refusal = (ctx: AuthenticatedContext) =>
			lists.individuals(other, {}, ctx).then(
				() => null,
				(e: Error) => e.message
			);
		const stranger403 = await refusal(stranger.context);
		expect(stranger403).toBeTruthy();
		expect(await refusal(visitorCtx)).toBe(stranger403);
	});

	it('can change nothing, including its own marks and view mode', async () => {
		const marks = new MarkService(t.db);
		const person = idOf('@I1@');
		await expect(marks.recordRecent(firstId, person, visitorCtx)).rejects.toMatchObject({
			status: 403
		});
		await expect(marks.addFavorite(firstId, person, visitorCtx)).rejects.toMatchObject({
			status: 403
		});
		await expect(marks.removeFavorite(firstId, person, visitorCtx)).rejects.toMatchObject({
			status: 403
		});
		await expect(
			new TreeService(t.db).setViewMode(firstId, 'flat', visitorCtx)
		).rejects.toMatchObject({
			status: 403
		});
		await expect(
			new MutationRunner(t.db).run(firstId, visitorCtx, {
				kind: 'x',
				summary: () => 'x',
				commands: []
			})
		).rejects.toMatchObject({ status: 403 });
		await expect(
			new TreeService(t.db).updateTree(firstId, 1, { name: 'x' }, visitorCtx)
		).rejects.toMatchObject({
			status: 403
		});
	});

	it('gets just the public tree as its tree list, as a viewer', async () => {
		expect(await new TreeService(t.db).listTrees(visitorCtx)).toMatchObject([
			{ id: firstId, role: 'viewer' }
		]);
	});

	it('is refused the members, privacy settings, tasks and quality report, for the visitor and a stranger alike', async () => {
		for (const ctx of [visitorCtx, stranger.context]) {
			await expect(new MemberService(t.db).list(firstId, ctx)).rejects.toMatchObject({
				status: 403
			});
			await expect(new PrivacyService(t.db).getSettings(firstId, ctx)).rejects.toMatchObject({
				status: 403
			});
			await expect(new TaskReadService(t.db).listTasks(firstId, {}, ctx)).rejects.toMatchObject({
				status: 403
			});
			await expect(new QualityService(t.db).report(firstId, ctx)).rejects.toMatchObject({
				status: 403
			});
		}
	});

	it("cannot follow or download the public tree's export", async () => {
		const instanceId = buildExportInstanceId(
			firstId,
			'gedcom7',
			false,
			'00000000-0000-4000-8000-000000000000'
		);
		for (const ctx of [visitorCtx, stranger.context]) {
			await expect(
				new GedcomService(t.db).requireExportInstance(instanceId, ctx)
			).rejects.toMatchObject({ status: 404 });
		}
	});
});
