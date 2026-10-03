/**
 * The person and partnership pages carry the evidence for what they show (ADR-028): every citation
 * in the order it is kept, a count on each fact and name, and the parent links named.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import SOURCES7 from '../gedcom/fixtures/sources7.ged?raw';
import { importGedcomToDb } from '../testing/gedcom';
import {
	createTestDatabase,
	createTestTree,
	createTestUser,
	type TestActor,
	type TestDatabase
} from '../testing/d1';
import { PersonPageService } from './person-page-service';
import { UnionPageService } from './union-page-service';

let t: TestDatabase;
let actor: TestActor;
let treeId: string;
beforeAll(async () => {
	t = await createTestDatabase();
	actor = await createTestUser(t.db, 'owner');
	treeId = await createTestTree(t.db, actor);
	await importGedcomToDb(t.d1, treeId, SOURCES7, 'Evidence pages');
});
afterAll(async () => {
	await t.dispose();
});

describe('the person page', () => {
	it('carries every citation of the person, their names, facts and parent link, in order', async () => {
		const dto = await new PersonPageService(t.db).getPerson(
			treeId,
			`${treeId}:@I1@`,
			actor.context
		);
		const byKind = (kind: string) =>
			dto.evidence.citations.filter((c) => c.subject.kind === kind).map((c) => c.page);
		expect(byKind('person')).toEqual(['12', '99']);
		expect(byKind('name')).toEqual(['name page']);
		expect(byKind('event')).toEqual(['first', 'second', 'third']);
		expect(byKind('parent_child')).toEqual(['link page']);
		expect(dto.evidence.citations.find((c) => c.page === '12')).toMatchObject({
			sourceLabel: 'Parish register',
			quality: 3,
			entryDate: 'ABT 1901',
			text: 'As written'
		});
		expect(dto.evidence.links).toHaveLength(1);
	});

	it('counts the citations on each fact and name; an uncited one is unsourced', async () => {
		const dto = await new PersonPageService(t.db).getPerson(
			treeId,
			`${treeId}:@I1@`,
			actor.context
		);
		expect(dto.facts.find((f) => f.type === 'BIRT')?.citationCount).toBe(3);
		expect(dto.names[0].citationCount).toBe(1);
		const bob = await new PersonPageService(t.db).getPerson(
			treeId,
			`${treeId}:@I2@`,
			actor.context
		);
		expect(bob.evidence.citations).toEqual([]);
		expect(bob.names[0].citationCount).toBe(0);
	});
});

describe('the partnership page', () => {
	it('carries the citations of the partnership, its marriage and the parent link', async () => {
		const dto = await new UnionPageService(t.db).getUnion(treeId, `${treeId}:@F1@`, actor.context);
		expect(dto.evidence.citations.map((c) => [c.subject.kind, c.page]).sort()).toEqual([
			['event', 'marr page'],
			['parent_child', 'link page'],
			['union', 'fam page']
		]);
		expect(dto.events.find((e) => e.type === 'MARR')?.citationCount).toBe(1);
		expect(dto.evidence.links[0].label).toContain('Ash');
	});
});
