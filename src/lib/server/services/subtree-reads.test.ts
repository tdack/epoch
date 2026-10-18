/**
 * Scoped reads for an active sub-tree (docs/proposal-subtrees.md, "What the lens scopes"), over a
 * real database. Each read is compared with and without the lens on one fixture, so the counts, the
 * page fill and `hasMore` are shown to be computed in scope rather than filtered afterwards.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { importGedcomToDb } from '../testing/gedcom';
import {
	createTestDatabase,
	createTestTree,
	createTestUser,
	type TestActor,
	type TestDatabase
} from '../testing/d1';
import type { SubtreeSummaryDto } from '../../shared/subtrees';
import { GraphQueryService } from './graph-query-service';
import { ListService } from './list-service';
import { PersonPageService } from './person-page-service';
import { PlaceService } from './place-service';
import { SearchService } from './search-service';

// Members of the line rooted at Rex: Rex, Cleo (child), Gus (grandchild) and Pat (Cleo's partner).
// Pete (Pat's father) and Zed are not.
const FIXTURE = `0 HEAD
0 @I1@ INDI
1 NAME Rex /Alpha/
1 BIRT
2 PLAC Hobart
1 FAMS @F1@
0 @I2@ INDI
1 NAME Cleo /Alpha/
1 BIRT
2 PLAC Hobart
1 FAMC @F1@
1 FAMS @F2@
0 @I3@ INDI
1 NAME Gus /Alpha/
1 BIRT
2 PLAC Perth
1 FAMC @F2@
0 @I4@ INDI
1 NAME Pat /Beta/
1 FAMS @F2@
1 FAMC @F3@
0 @I5@ INDI
1 NAME Pete /Beta/
1 FAMS @F3@
0 @I6@ INDI
1 NAME Zed /Gamma/
1 BIRT
2 PLAC Darwin
0 @F1@ FAM
1 HUSB @I1@
1 CHIL @I2@
0 @F2@ FAM
1 HUSB @I4@
1 WIFE @I2@
1 CHIL @I3@
1 MARR
2 PLAC Perth
0 @F3@ FAM
1 HUSB @I5@
1 CHIL @I4@
1 MARR
2 PLAC Darwin
0 TRLR`;

let t: TestDatabase;
let actor: TestActor;
let treeId: string;
let lens: SubtreeSummaryDto;

const ctx = () => actor.context;
const xrefs = (page: { items: Array<{ id: string }> }) => page.items.map((p) => p.id.split(':')[1]);
const root = () => lens.rootPersonId;

beforeAll(async () => {
	t = await createTestDatabase();
	actor = await createTestUser(t.db);
	treeId = await createTestTree(t.db, actor);
	await importGedcomToDb(t.d1, treeId, FIXTURE, 'Lens');
	lens = { id: 'sub', slug: 'rex-line', name: 'Rex line', rootPersonId: `${treeId}:@I1@` };
}, 60_000);
afterAll(async () => {
	await t.dispose();
});

describe('the individuals list', () => {
	it('lists only members, and fills the page from them', async () => {
		const service = new ListService(t.db);
		const whole = await service.individuals(treeId, { limit: 50 }, ctx());
		expect(whole.items).toHaveLength(6);
		const scoped = await service.individuals(treeId, { limit: 50 }, ctx(), root());
		expect(xrefs(scoped).sort()).toEqual(['@I1@', '@I2@', '@I3@', '@I4@']);
		// A page of two out of four members is full and has more; nothing is dropped after the fact.
		const first = await service.individuals(treeId, { limit: 2 }, ctx(), root());
		const second = await service.individuals(treeId, { limit: 2, offset: 2 }, ctx(), root());
		expect(first.items).toHaveLength(2);
		expect(first.hasMore).toBe(true);
		expect(second.items).toHaveLength(2);
		expect(second.hasMore).toBe(false);
	});

	it('applies the lens beside the surname filter', async () => {
		const scoped = await new ListService(t.db).individuals(
			treeId,
			{ limit: 50, surname: 'Beta' },
			ctx(),
			root()
		);
		expect(xrefs(scoped)).toEqual(['@I4@']);
	});
});

describe('the surnames list', () => {
	it('counts members only and drops a surname no member has', async () => {
		const service = new ListService(t.db);
		const whole = await service.surnames(treeId, { limit: 50 }, ctx());
		expect(whole.items.map((s) => [s.surname, s.people])).toEqual([
			['Alpha', 3],
			['Beta', 2],
			['Gamma', 1]
		]);
		const scoped = await service.surnames(treeId, { limit: 50 }, ctx(), root());
		expect(scoped.items.map((s) => [s.surname, s.people])).toEqual([
			['Alpha', 3],
			['Beta', 1]
		]);
	});
});

describe('the unions list', () => {
	it('lists a partnership when any partner is a member', async () => {
		const service = new ListService(t.db);
		expect((await service.unions(treeId, { limit: 50 }, ctx())).items).toHaveLength(3);
		const scoped = await service.unions(treeId, { limit: 50 }, ctx(), root());
		// F1 (Rex) and F2 (Cleo and Pat); F3 has only Pete, who is not a member.
		expect(scoped.items).toHaveLength(2);
		expect(scoped.items.flatMap((u) => u.partners.map((p) => p.displayName))).not.toContain(
			'Pete Beta'
		);
	});
});

describe('the places list', () => {
	it('counts only the facts of members and of their partnerships', async () => {
		const service = new PlaceService(t.db);
		const whole = await service.list(treeId, { limit: 50 }, ctx());
		expect(whole.items.map((p) => p.name).sort()).toEqual(['Darwin', 'Hobart', 'Perth']);
		const scoped = await service.list(treeId, { limit: 50 }, ctx(), root());
		const byName = new Map(scoped.items.map((p) => [p.name, p]));
		expect([...byName.keys()].sort()).toEqual(['Hobart', 'Perth']);
		// Perth: Gus's birth and the partnership F2's marriage.
		expect(byName.get('Perth')).toMatchObject({ facts: 2, people: 1 });
	});

	it("narrows a place page's facts, and a place with none in scope is not found", async () => {
		const service = new PlaceService(t.db);
		const wholeDarwin = await service.detail(treeId, 'Darwin', { limit: 50 }, ctx());
		expect(wholeDarwin.facts).toHaveLength(2);
		await expect(service.detail(treeId, 'Darwin', { limit: 50 }, ctx(), root())).rejects.toThrow();
		const perth = await service.detail(treeId, 'Perth', { limit: 50 }, ctx(), root());
		expect(perth.facts).toHaveLength(2);
	});
});

describe('search and the person finder', () => {
	it('returns members only, for a name, an XREF and an empty query with a place', async () => {
		const service = new SearchService(t.db);
		const names = async (query: Parameters<SearchService['search']>[1], lensRoot?: string) =>
			(await service.search(treeId, query, ctx(), lensRoot ?? null)).people
				.map((p) => p.displayName)
				.sort();
		expect(await names({ text: 'Beta' })).toEqual(['Pat Beta', 'Pete Beta']);
		expect(await names({ text: 'Beta' }, root())).toEqual(['Pat Beta']);
		expect(await names({ text: '@I5@' })).toEqual(['Pete Beta']);
		expect(await names({ text: '@I5@' }, root())).toEqual([]);
		expect(await names({ place: 'Darwin' })).toEqual(['Pete Beta', 'Zed Gamma']);
		expect(await names({ place: 'Darwin' }, root())).toEqual([]);
	});

	it('fills a page from members, so hasMore is about the lens', async () => {
		const service = new SearchService(t.db);
		const page = await service.search(treeId, { text: 'a', limit: 2 }, ctx(), root());
		expect(page.people).toHaveLength(2);
		expect(page.people.every((p) => !['Pete Beta', 'Zed Gamma'].includes(p.displayName))).toBe(
			true
		);
	});
});

describe('the whole-tree graph', () => {
	it('draws members only', async () => {
		const service = new GraphQueryService(t.db);
		const whole = await service.wholeTreeGraph(treeId, ctx());
		expect(whole.drawnPersonIds).toHaveLength(6);
		const scoped = await service.wholeTreeGraph(treeId, ctx(), lens);
		expect(scoped.drawnPersonIds.map((id) => id.split(':')[1]).sort()).toEqual([
			'@I1@',
			'@I2@',
			'@I3@',
			'@I4@'
		]);
	});
});

describe('the summary counts', () => {
	it('count the lens while it is active and the whole tree otherwise', async () => {
		const service = new GraphQueryService(t.db);
		expect((await service.summary(treeId, ctx())).counts).toEqual({ people: 6, unions: 3 });
		expect((await service.summary(treeId, ctx(), lens)).counts).toEqual({ people: 4, unions: 2 });
	});
});

describe('the person page', () => {
	it('says whether the person is in the lens, and only when asked through one', async () => {
		const service = new PersonPageService(t.db);
		const page = (xref: string, lensRoot: string | null) =>
			service.getPerson(treeId, `${treeId}:${xref}`, ctx(), lensRoot);
		expect((await page('@I5@', null)).isInSubtree).toBeUndefined();
		expect((await page('@I5@', root())).isInSubtree).toBe(false);
		expect((await page('@I4@', root())).isInSubtree).toBe(true);
	});
});
