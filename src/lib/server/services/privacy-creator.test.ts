/**
 * A contributor keeps sight of the people they created (ADR-015), so adding someone with no dated
 * fact does not make them vanish. It is the creator's alone: another contributor, a viewer, and a
 * manager's "private" still hide them.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { individuals } from '../db/schema';
import { eq } from 'drizzle-orm';
import { NotFoundError } from '../domain/errors';
import type { TreeRole } from '../domain/identity';
import { privatePeople } from '../domain/privacy-mask';
import { importGedcomToDb } from '../gedcom/importer';
import { visibleAmong } from '../repositories/visibility';
import {
	addTestMember,
	createTestDatabase,
	createTestTree,
	createTestUser,
	type TestActor,
	type TestDatabase
} from '../testing/d1';
import { GenealogyService } from './genealogy-service';
import { GraphQueryService } from './graph-query-service';
import { FactService } from './fact-service';
import { ListService } from './list-service';
import { PersonPageService } from './person-page-service';
import { PrivacyService } from './privacy-service';
import { RelationshipService } from './relationship-service';
import { SearchService } from './search-service';

const FIXTURE = `0 HEAD
0 @I1@ INDI
1 NAME Olda /Oldman/
1 BIRT
2 DATE 1850
0 TRLR`;

const NOW = new Date('2026-10-01T12:00:00Z');
const clock = () => ({ now: () => NOW.getTime(), newId: () => crypto.randomUUID() });

let t: TestDatabase;
let treeId: string;
let parentId: string;
const actors = {} as Record<TreeRole | 'other', TestActor>;
// The planner mints the id of a new person, so it is looked up after the creator adds them.
let NEWKID = '';

const search = () => new SearchService(t.db, () => NOW);
const lists = () => new ListService(t.db, () => NOW);
const pages = () => new PersonPageService(t.db, () => NOW);
const canSee = async (who: TestActor) =>
	(await search().search(treeId, { text: 'Newkid' }, who.context)).people.length === 1;

beforeAll(async () => {
	t = await createTestDatabase();
	actors.owner = await createTestUser(t.db, 'owner');
	treeId = await createTestTree(t.db, actors.owner);
	for (const role of ['editor', 'contributor', 'viewer'] as const) {
		actors[role] = await createTestUser(t.db, role);
		await addTestMember(t.db, treeId, actors[role], role);
	}
	actors.other = await createTestUser(t.db, 'other contributor');
	await addTestMember(t.db, treeId, actors.other, 'contributor');
	await importGedcomToDb(t.d1, treeId, FIXTURE, 'Creator');
	parentId = (
		await t.db
			.select({ id: individuals.id })
			.from(individuals)
			.where(eq(individuals.treeId, treeId))
	)[0]!.id;

	// The contributor adds a child with no date of any kind.
	await new RelationshipService(t.db, clock()).execute(
		treeId,
		{
			kind: 'add_child',
			parent: { id: parentId, givenName: 'Olda', surname: 'Oldman' },
			child: { id: 'ignored', isNew: true, givenName: 'Newkid', surname: 'Oldman' },
			type: 'biological',
			unionLabel: null
		},
		actors.contributor.context
	);
	NEWKID = (
		await t.db
			.select({ id: individuals.id })
			.from(individuals)
			.where(eq(individuals.givenName, 'Newkid'))
	)[0]!.id;
}, 60_000);
afterAll(async () => {
	await t.dispose();
});

describe('a person with no dated fact, created by a contributor', () => {
	it('records who created them', async () => {
		const row = (await t.db.select().from(individuals).where(eq(individuals.id, NEWKID)))[0]!;
		expect(row.createdBy).toBe(actors.contributor.context.user.id);
	});

	it('is visible to their creator and to everyone who sees private people, and to nobody else', async () => {
		expect(await canSee(actors.contributor)).toBe(true);
		for (const role of ['owner', 'editor'] as const)
			expect(await canSee(actors[role]), role).toBe(true);
		expect(await canSee(actors.other)).toBe(false);
		expect(await canSee(actors.viewer)).toBe(false);
	});

	it("is in the creator's lists and open on their page, and absent from another contributor's", async () => {
		const mine = await lists().individuals(treeId, { limit: 50 }, actors.contributor.context);
		const theirs = await lists().individuals(treeId, { limit: 50 }, actors.other.context);
		expect(mine.items.map((p) => p.id)).toContain(NEWKID);
		expect(theirs.items.map((p) => p.id)).not.toContain(NEWKID);
		await expect(
			pages().getPerson(treeId, NEWKID, actors.contributor.context)
		).resolves.toBeTruthy();
		await expect(pages().getPerson(treeId, NEWKID, actors.other.context)).rejects.toBeInstanceOf(
			NotFoundError
		);
	});

	it('can be changed by their creator, who can then date them, and not by another contributor', async () => {
		const fact = {
			type: 'OCCU',
			dateText: null,
			place: null,
			value: 'Baker',
			cause: null,
			age: null,
			notes: null
		} as never;
		const facts = () => new FactService(t.db, clock());
		await expect(
			facts().create(treeId, NEWKID, fact, actors.contributor.context)
		).resolves.toBeTruthy();
		await expect(facts().create(treeId, NEWKID, fact, actors.other.context)).rejects.toBeInstanceOf(
			NotFoundError
		);
	});

	it("is in the creator's tree and not in another contributor's", async () => {
		const options = {
			ancestorDepth: 2,
			descendantDepth: 2,
			shouldIncludeSiblings: true,
			shouldIncludeStepFamilies: true
		};
		const names = async (who: TestActor) =>
			(
				await new GraphQueryService(t.db, () => NOW).focusGraph(
					treeId,
					parentId,
					options,
					who.context
				)
			).graph.people
				.map((p) => p.displayName)
				.join('|');
		expect(await names(actors.contributor)).toContain('Newkid');
		expect(await names(actors.other)).not.toContain('Newkid');
	});

	it('is recorded for a person made by the Add person form too, not only by a relationship', async () => {
		const { individual } = await new GenealogyService(t.db, clock()).createIndividual(
			treeId,
			{ givenName: 'Formed', surname: 'Direct' },
			actors.contributor.context
		);
		const found = async (who: TestActor) =>
			(await search().search(treeId, { text: 'Formed' }, who.context)).people.length;
		expect(await found(actors.contributor)).toBe(1);
		expect(await found(actors.other)).toBe(0);
		expect(
			(await t.db.select().from(individuals).where(eq(individuals.id, individual.id)))[0]!.createdBy
		).toBe(actors.contributor.userId);
	});

	it("is counted in the creator's header and not in another contributor's", async () => {
		const mine = await lists().individuals(treeId, { limit: 50 }, actors.contributor.context);
		const theirs = await lists().individuals(treeId, { limit: 50 }, actors.other.context);
		// Theirs: the person they added, and the one the Add person form made for them.
		expect(mine.items.length).toBe(theirs.items.length + 2);
	});

	it('agrees between the SQL predicate and the pure rule', async () => {
		const creatorId = actors.contributor.context.user.id;
		const scope = { isRestricted: true, cutoff: '1906-10-01', creatorId };
		const seen = await visibleAmong(t.db, treeId, [NEWKID, parentId], scope);
		expect(seen.has(NEWKID)).toBe(true);
		const rows = await new (await import('../repositories/change-store')).ChangeStore(
			t.db
		).loadRows(treeId);
		expect(privatePeople(rows, scope.cutoff, creatorId).has(NEWKID)).toBe(false);
		expect(privatePeople(rows, scope.cutoff, null).has(NEWKID)).toBe(true);
		expect(
			(await visibleAmong(t.db, treeId, [NEWKID], { ...scope, creatorId: null })).has(NEWKID)
		).toBe(false);
	});

	it('is hidden again from their creator when a manager forces them private', async () => {
		const privacy = new PrivacyService(t.db, clock());
		await privacy.setPersonPrivacy(treeId, NEWKID, 'private', undefined, actors.owner.context);
		expect(await canSee(actors.contributor)).toBe(false);
		await expect(
			pages().getPerson(treeId, NEWKID, actors.contributor.context)
		).rejects.toBeInstanceOf(NotFoundError);
		await privacy.setPersonPrivacy(treeId, NEWKID, 'auto', undefined, actors.owner.context);
		expect(await canSee(actors.contributor)).toBe(true);
	});
});
