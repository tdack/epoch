import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { citations, events } from '../db/schema';
import { NotFoundError, ValidationError } from '../domain/errors';
import { MAX_GROUP_FACT_PEOPLE } from '../../shared/fact-types';
import {
	createTestDatabase,
	createTestTree,
	createTestUser,
	type TestDatabase
} from '../testing/d1';
import { ChangeLogService } from './change-log-service';
import { EvidenceService } from './evidence-service';
import { FactService } from './fact-service';
import { PersonService } from './person-service';

let t: TestDatabase;
beforeAll(async () => {
	t = await createTestDatabase();
});
afterAll(async () => {
	await t.dispose();
});

const blank = { dateText: null, place: null, value: null, cause: null, age: null, notes: null };

async function setup() {
	const actor = await createTestUser(t.db);
	const treeId = await createTestTree(t.db, actor);
	const ctx = actor.context;
	const people = new PersonService(t.db);
	const ids: string[] = [];
	for (const givenName of ['Ann', 'Ben', 'Cy'])
		ids.push((await people.create(treeId, { givenName, surname: 'Ash' }, ctx)).individual.id);
	const evidence = new EvidenceService(t.db);
	const { sourceId } = await evidence.createSource(treeId, { title: 'Ash family book' }, ctx);
	const allCitations = () =>
		t.db.select().from(citations).where(eq(citations.treeId, treeId)).all();
	const allEvents = () => t.db.select().from(events).where(eq(events.treeId, treeId)).all();
	return {
		treeId,
		ctx,
		ids,
		sourceId,
		evidence,
		facts: new FactService(t.db),
		allCitations,
		allEvents,
		log: new ChangeLogService(t.db)
	};
}

describe('group facts', () => {
	it('copies a fact and its citation onto each person in one change, and one undo removes all', async () => {
		const { treeId, ctx, ids, sourceId, facts, allCitations, allEvents, log } = await setup();
		const { factIds, change } = await facts.createMany(
			treeId,
			ids,
			{ ...blank, type: 'EMIG', place: 'Sydney' },
			ctx,
			{ sourceId, page: 'p 4' }
		);
		expect(factIds).toHaveLength(3);
		expect(new Set(factIds).size).toBe(3);
		expect(
			(await allEvents())
				.filter((e) => e.type === 'EMIG')
				.map((e) => e.entityId)
				.sort()
		).toEqual([...ids].sort());
		expect(await allCitations()).toHaveLength(3);
		expect(change?.summary).toBe('Added emigration to 3 people');
		await log.undoLast(treeId, ctx);
		expect((await allEvents()).filter((e) => e.type === 'EMIG')).toHaveLength(0);
		expect(await allCitations()).toHaveLength(0);
	});

	it('dedupes people and refuses an empty or oversized group', async () => {
		const { treeId, ctx, ids, facts, allEvents } = await setup();
		const { factIds } = await facts.createMany(
			treeId,
			[ids[0], ids[0], ids[1]],
			{ ...blank, type: 'EMIG' },
			ctx
		);
		expect(factIds).toHaveLength(2);
		expect((await allEvents()).filter((e) => e.type === 'EMIG')).toHaveLength(2);
		const many = Array.from({ length: MAX_GROUP_FACT_PEOPLE + 1 }, (_, i) => `p${i}`);
		await expect(
			facts.createMany(treeId, many, { ...blank, type: 'EMIG' }, ctx)
		).rejects.toBeInstanceOf(ValidationError);
		await expect(
			facts.createMany(treeId, [], { ...blank, type: 'EMIG' }, ctx)
		).rejects.toBeInstanceOf(ValidationError);
	});
});

describe('citing a source for many people', () => {
	it('cites each person, skips those already cited, and undoes in one step', async () => {
		const { treeId, ctx, ids, sourceId, evidence, allCitations, log } = await setup();
		await evidence.addCitation(treeId, { kind: 'person', id: ids[0] }, { sourceId }, ctx);
		const result = await evidence.citeMany(
			treeId,
			sourceId,
			[...ids, ids[1]],
			{ sourceId },
			undefined,
			ctx
		);
		expect(result.skippedPersonIds).toEqual([ids[0]]);
		expect(result.change?.summary).toBe('Cited “Ash family book” for 2 people');
		expect(await allCitations()).toHaveLength(3);
		await log.undoLast(treeId, ctx);
		expect(await allCitations()).toHaveLength(1);
	});

	it('writes nothing when everyone is already cited, and refuses 51 people', async () => {
		const { treeId, ctx, ids, sourceId, evidence, allCitations } = await setup();
		await evidence.citeMany(treeId, sourceId, ids, { sourceId }, undefined, ctx);
		const again = await evidence.citeMany(treeId, sourceId, ids, { sourceId }, undefined, ctx);
		expect(again.change).toBeNull();
		expect(again.skippedPersonIds).toHaveLength(3);
		expect(await allCitations()).toHaveLength(3);
		const many = Array.from({ length: MAX_GROUP_FACT_PEOPLE + 1 }, (_, i) => `p${i}`);
		await expect(
			evidence.citeMany(treeId, sourceId, many, { sourceId }, undefined, ctx)
		).rejects.toBeInstanceOf(ValidationError);
	});
});

describe('citing a fact type for many people', () => {
	const birth = (type = 'BIRT') => ({ ...blank, type });

	it('cites each matching fact, skips cited ones, reports people without one, undoes in one step', async () => {
		const { treeId, ctx, ids, sourceId, evidence, facts, allCitations, log } = await setup();
		const a = await facts.create(treeId, ids[0], birth(), ctx);
		const b1 = await facts.create(treeId, ids[1], birth(), ctx);
		const b2 = await facts.create(treeId, ids[1], birth(), ctx);
		await evidence.addCitation(treeId, { kind: 'event', id: a.factId }, { sourceId }, ctx);
		const before = (await allCitations()).length;
		const logBefore = (await log.listRecent(treeId, ctx)).length;
		const result = await evidence.citeMany(treeId, sourceId, ids, { sourceId }, 'BIRT', ctx);
		expect(result.skippedPersonIds).toEqual([ids[0]]);
		expect(result.missingFactPersonIds).toEqual([ids[2]]);
		expect(result.change?.summary).toBe('Cited “Ash family book” on 2 Birth facts');
		const added = (await allCitations()).filter((c) => c.subjectKind === 'event');
		expect(added.map((c) => c.subjectId).sort()).toEqual([a.factId, b1.factId, b2.factId].sort());
		expect((await log.listRecent(treeId, ctx)).length).toBe(logBefore + 1);
		await log.undoLast(treeId, ctx);
		expect(await allCitations()).toHaveLength(before);
	});

	it('refuses a person that does not exist, as the person-level batch does', async () => {
		const { treeId, ctx, ids, sourceId, evidence, allCitations } = await setup();
		await expect(
			evidence.citeMany(treeId, sourceId, [ids[0], 'nobody'], { sourceId }, 'BIRT', ctx)
		).rejects.toBeInstanceOf(NotFoundError);
		expect(await allCitations()).toHaveLength(0);
	});
});
