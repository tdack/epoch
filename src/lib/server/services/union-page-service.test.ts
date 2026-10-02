import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import simpsonsDirty from '../../../../docs/The_Simpsons.ged?raw';
import simpsonsClean from '../../../../docs/The_Simpsons_clean.ged?raw';
import { importGedcomToDb } from '../gedcom/importer';
import { NotFoundError, UnauthorizedError } from '../domain/errors';
import { graphFromRows } from '../domain/relationship-graph';
import { ChangeStore } from '../repositories/change-store';
import { CHRONOLOGY_KINDS, UnionPageService } from './union-page-service';
import { UNION_WARNING_CODES } from '../../shared/union-warnings';
import {
	createTestDatabase,
	createTestTree,
	createTestUser,
	type TestActor,
	type TestDatabase
} from '../testing/d1';
import { GenealogyService } from './genealogy-service';
import { RelationshipService } from './relationship-service';

let t: TestDatabase;
let actor: TestActor;
beforeAll(async () => {
	t = await createTestDatabase();
	actor = await createTestUser(t.db);
});
afterAll(async () => {
	await t.dispose();
});

const service = () => new UnionPageService(t.db);

async function importedTree(gedcom: string) {
	const treeId = await createTestTree(t.db, actor);
	await importGedcomToDb(t.d1, treeId, gedcom, 'Imported');
	return treeId;
}

describe('the partnership page of The Simpsons', () => {
	it('shows the partners in order, the children with their links, and the same partnership label the tree does', async () => {
		const treeId = await importedTree(simpsonsClean);
		const whole = graphFromRows(await new ChangeStore(t.db).loadRows(treeId));
		for (const union of whole.unions) {
			const page = await service().getUnion(treeId, union.id, actor.context);
			expect(page.partners.map((p) => p.id)).toEqual(union.partnerIds);
			expect([...new Set(page.children.map((c) => c.person.id))].sort()).toEqual(
				[...new Set(union.children.map((c) => c.childId))].sort()
			);
			expect(page.union.status).toBe(union.status);
			expect(page.events.map((e) => e.type)).toEqual(union.events?.map((e) => e.type) ?? []);
		}
	});

	it('numbers repeated partnerships between the same pair and lists the others as twins, on the dirty file', async () => {
		const treeId = await importedTree(simpsonsDirty);
		const whole = graphFromRows(await new ChangeStore(t.db).loadRows(treeId));
		const twinned = whole.unions.filter(
			(u) =>
				u.partnerIds.length === 2 &&
				whole.unions.filter(
					(v) => v.partnerIds.slice().sort().join() === u.partnerIds.slice().sort().join()
				).length > 1
		);
		expect(twinned.length).toBeGreaterThan(1);
		const page = await service().getUnion(treeId, twinned[0]!.id, actor.context);
		expect(page.union.label?.title).toMatch(/partnership$/);
		expect(page.twins.length).toBeGreaterThan(0);
		expect(page.warnings.map((w) => w.code)).toContain(UNION_WARNING_CODES.MERGEABLE_TWIN);
	});
});

describe('chronology and warnings', () => {
	async function couple() {
		const treeId = await createTestTree(t.db, actor);
		const people = new GenealogyService(t.db);
		const relationships = new RelationshipService(t.db);
		const add = async (givenName: string, extra: object = {}) =>
			(await people.createIndividual(treeId, { givenName, ...extra }, actor.context)).individual;
		const [ann, ben] = [
			await add('Ann', { birthDate: '1901' }),
			await add('Ben', { birthDate: '1899', deathDate: '1940' })
		];
		const ref = (p: { id: string; givenName: string | null }) => ({
			id: p.id,
			givenName: p.givenName,
			surname: null
		});
		await relationships.execute(
			treeId,
			{ kind: 'add_partner', person: ref(ann), partner: ref(ben), unionLabel: null },
			actor.context
		);
		const graph = await relationships.getGraph(treeId, actor.context);
		return { treeId, ann, ben, unionId: graph.unions[0]!.id, add, ref, relationships, graph };
	}

	it('puts events, births and deaths in date order with undated ones last', async () => {
		const { treeId, unionId, ann, add, ref, relationships } = await couple();
		const kid = await add('Cat', { birthDate: '1925' });
		await relationships.execute(
			treeId,
			{
				kind: 'add_child',
				parent: ref(ann),
				child: ref(kid),
				type: 'biological',
				unionLabel: null,
				unionId
			},
			actor.context
		);
		await new RelationshipService(t.db).updateUnion(
			treeId,
			{
				kind: 'update_union',
				unionId,
				expectedVersion: 1,
				events: [
					{ id: null, type: 'MARR', dateText: '1922', place: 'Leeds' },
					{ id: null, type: 'ENGA', dateText: null, place: null }
				]
			},
			actor.context
		);
		const page = await service().getUnion(treeId, unionId, actor.context);
		expect(page.chronology.map((c) => [c.kind, c.dateText])).toEqual([
			[CHRONOLOGY_KINDS.PARTNER_BIRTH, '1899'],
			[CHRONOLOGY_KINDS.PARTNER_BIRTH, '1901'],
			[CHRONOLOGY_KINDS.UNION_EVENT, '1922'],
			[CHRONOLOGY_KINDS.CHILD_BIRTH, '1925'],
			[CHRONOLOGY_KINDS.PARTNER_DEATH, '1940'],
			[CHRONOLOGY_KINDS.UNION_EVENT, null]
		]);
	});

	it('warns about a marriage dated before a partner was born, and about a death in an active partnership', async () => {
		const { treeId, unionId } = await couple();
		await new RelationshipService(t.db).updateUnion(
			treeId,
			{
				kind: 'update_union',
				unionId,
				expectedVersion: 1,
				events: [{ id: null, type: 'MARR', dateText: '1890', place: null }]
			},
			actor.context
		);
		const page = await service().getUnion(treeId, unionId, actor.context);
		expect(page.warnings.map((w) => w.code).sort()).toEqual(
			[
				UNION_WARNING_CODES.EVENT_BEFORE_BIRTH,
				UNION_WARNING_CODES.EVENT_BEFORE_BIRTH,
				UNION_WARNING_CODES.PARTNER_DIED
			].sort()
		);
	});

	it('lists the changes that wrote the partnership, and marks every record not private', async () => {
		const { treeId, unionId } = await couple();
		const page = await service().getUnion(treeId, unionId, actor.context);
		expect(page.changes.recent[0]!.summary).toMatch(/partnership|Ann/);
		expect(page.isPrivate).toBe(false);
		expect(page.partners.every((p) => p.isPrivate === false)).toBe(true);
	});

	it('refuses a stranger and answers 404 for a partnership in another tree', async () => {
		const first = await couple();
		const second = await couple();
		const stranger = await createTestUser(t.db, 'stranger');
		await expect(
			service().getUnion(first.treeId, first.unionId, stranger.context)
		).rejects.toBeInstanceOf(UnauthorizedError);
		await expect(
			service().getUnion(first.treeId, second.unionId, actor.context)
		).rejects.toBeInstanceOf(NotFoundError);
	});
});
