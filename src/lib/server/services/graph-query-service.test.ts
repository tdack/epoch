import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { individuals } from '../db/schema';
import { NotFoundError, UnauthorizedError } from '../domain/errors';
import {
	addTestMember,
	createTestDatabase,
	createTestTree,
	createTestUser,
	type TestDatabase
} from '../testing/d1';
import { GenealogyService } from './genealogy-service';
import { GraphQueryService } from './graph-query-service';
import { RelationshipService } from './relationship-service';

let t: TestDatabase;
beforeAll(async () => {
	t = await createTestDatabase();
});
afterAll(async () => {
	await t.dispose();
});

async function setup() {
	const owner = await createTestUser(t.db, 'owner');
	const treeId = await createTestTree(t.db, owner);
	const people = new GenealogyService(t.db);
	const relationships = new RelationshipService(t.db);
	const add = async (givenName: string) =>
		(await people.createIndividual(treeId, { givenName }, owner.context)).individual;
	const [ann, ben, cat] = [await add('Ann'), await add('Ben'), await add('Cat')];
	const ref = (p: { id: string; givenName: string | null }) => ({
		id: p.id,
		givenName: p.givenName,
		surname: null
	});
	await relationships.execute(
		treeId,
		{ kind: 'add_partner', person: ref(ann), partner: ref(ben), unionLabel: null },
		owner.context
	);
	await relationships.execute(
		treeId,
		{ kind: 'add_child', parent: ref(ann), child: ref(cat), type: 'biological', unionLabel: null },
		owner.context
	);
	return { owner, treeId, ann, ben, cat, service: new GraphQueryService(t.db) };
}

describe('GraphQueryService', () => {
	it('answers the summary with counts and the first person as the default focus', async () => {
		const { owner, treeId, ann, service } = await setup();
		const summary = await service.summary(treeId, owner.context);
		expect(summary.counts).toMatchObject({ people: 3, unions: 1 });
		expect(summary.defaultFocusPersonId).toBe(ann.id);
	});

	it('gives an empty tree no default focus', async () => {
		const owner = await createTestUser(t.db, 'owner');
		const treeId = await createTestTree(t.db, owner);
		expect(
			(await new GraphQueryService(t.db).summary(treeId, owner.context)).defaultFocusPersonId
		).toBeNull();
	});

	it('returns the drawn people and the graph for a focus', async () => {
		const { owner, treeId, cat, ann, service } = await setup();
		const dto = await service.focusGraph(treeId, cat.id, {}, owner.context);
		expect(dto.focusPersonId).toBe(cat.id);
		expect(dto.drawnPersonIds).toContain(ann.id);
		expect(dto.graph.people.map((p) => p.id)).toContain(cat.id);
	});

	it('lets a viewer read and refuses someone who is not a member', async () => {
		const { treeId, ann, service } = await setup();
		const viewer = await createTestUser(t.db, 'viewer');
		await addTestMember(t.db, treeId, viewer, 'viewer');
		// Ann has no dated fact, so she is private to a viewer until an owner says otherwise (ADR-015).
		await expect(service.focusGraph(treeId, ann.id, {}, viewer.context)).rejects.toBeInstanceOf(
			NotFoundError
		);
		await t.db.update(individuals).set({ privacy: 'public' }).where(eq(individuals.id, ann.id));
		await expect(service.focusGraph(treeId, ann.id, {}, viewer.context)).resolves.toBeTruthy();

		const stranger = await createTestUser(t.db, 'stranger');
		await expect(service.focusGraph(treeId, ann.id, {}, stranger.context)).rejects.toBeInstanceOf(
			UnauthorizedError
		);
		await expect(service.summary(treeId, stranger.context)).rejects.toBeInstanceOf(
			UnauthorizedError
		);
	});

	it('refuses a tree that does not exist, rather than failing on a foreign key', async () => {
		const { owner, service } = await setup();
		const missing = crypto.randomUUID();
		await expect(service.summary(missing, owner.context)).rejects.toBeInstanceOf(UnauthorizedError);
		await expect(service.focusGraph(missing, 'anyone', {}, owner.context)).rejects.toBeInstanceOf(
			UnauthorizedError
		);
	});

	it("answers 404 for a person in another of the caller's trees", async () => {
		const first = await setup();
		const second = await setup();
		await expect(
			first.service.focusGraph(first.treeId, second.ann.id, {}, first.owner.context)
		).rejects.toBeInstanceOf(NotFoundError);
	});
});
