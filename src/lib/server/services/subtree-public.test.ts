/**
 * A public tree's sub-trees for someone with no membership (ADR-069): a visitor sees one only when
 * a manager made it public and its root is visible to them; members are unaffected.
 */

import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { individuals, trees } from '../db/schema';
import { NotFoundError } from '../domain/errors';
import {
	addTestMember,
	createTestDatabase,
	createTestTree,
	createTestUser,
	type TestActor,
	type TestDatabase
} from '../testing/d1';
import { GraphQueryService } from './graph-query-service';
import { SubtreeService } from './subtree-service';

let t: TestDatabase;
let manager: TestActor;
let viewer: TestActor;
let visitor: TestActor;
let treeId: string;
let service: SubtreeService;

const person = (id: string, privacy: 'public' | 'private') =>
	t.db.insert(individuals).values({ id, treeId, givenName: id, privacy });

beforeAll(async () => {
	t = await createTestDatabase();
	manager = await createTestUser(t.db, 'manager');
	viewer = await createTestUser(t.db, 'viewer');
	visitor = await createTestUser(t.db, 'visitor');
	treeId = await createTestTree(t.db, manager);
	await addTestMember(t.db, treeId, viewer, 'viewer');
	await t.db.update(trees).set({ isPublic: true }).where(eq(trees.id, treeId));
	service = new SubtreeService(t.db);
	await person('open-root', 'public');
	await person('hidden-root', 'private');
	const make = (slug: string, rootPersonId: string, isPublic?: boolean) =>
		service.create(treeId, { name: slug, slug, rootPersonId, isPublic }, manager.context);
	await make('shown', 'open-root', true);
	await make('members-only', 'open-root');
	await make('public-but-private-root', 'hidden-root', true);
}, 60_000);
afterAll(async () => {
	await t.dispose();
});

const slugs = async (who: TestActor) =>
	(await service.list(treeId, who.context)).map((s) => s.slug);

describe('sub-trees of a public tree', () => {
	it('shows a visitor only the public ones whose root they may see', async () => {
		expect(await slugs(visitor)).toEqual(['shown']);
	});

	it('answers by slug only for those, and 404s the rest without a hint', async () => {
		expect((await service.get(treeId, 'shown', visitor.context)).isPublic).toBe(true);
		for (const hidden of ['members-only', 'public-but-private-root']) {
			await expect(service.get(treeId, hidden, visitor.context)).rejects.toBeInstanceOf(
				NotFoundError
			);
		}
	});

	it('puts the public ones in the visitor’s summary, which feeds the switcher', async () => {
		const { subtrees } = await new GraphQueryService(t.db).summary(treeId, visitor.context);
		expect(subtrees.map((s) => s.slug)).toEqual(['shown']);
	});

	it('leaves members unaffected: a viewer sees every sub-tree with a visible root', async () => {
		expect(await slugs(viewer)).toEqual(['shown', 'members-only']);
		expect(await slugs(manager)).toEqual(['shown', 'members-only', 'public-but-private-root']);
	});

	it('is changed by a manager, and an update of the flag is a logged edit', async () => {
		const before = await service.get(treeId, 'members-only', manager.context);
		await service.update(
			treeId,
			before.id,
			{ isPublic: true, version: before.version },
			manager.context
		);
		expect(await slugs(visitor)).toEqual(['shown', 'members-only']);
		await service.update(treeId, before.id, { isPublic: false }, manager.context);
		expect(await slugs(visitor)).toEqual(['shown']);
	});
});
