/**
 * What a contributor or viewer can reach of a private person through the paged reads (ADR-015):
 * search, the three lists and favourites. The same tree read by an owner and an editor is the
 * control, so a test that passes for the wrong reason (a tree with nobody private) cannot.
 */

import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { events, individuals } from '../db/schema';
import { NotFoundError } from '../domain/errors';
import type { TreeRole } from '../domain/identity';
import { isPersonPrivate, livingCutoff } from '../domain/living-state';
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
import { ListService } from './list-service';
import { MarkService } from './mark-service';
import { SearchService } from './search-service';

const NOW = new Date('2026-10-01T12:00:00Z');
const CUTOFF = livingCutoff(NOW);

const FIXTURE = `0 HEAD
0 @I1@ INDI
1 NAME Dora /Deadly/
1 BURI
0 @I2@ INDI
1 NAME Olga /Oldfield/
1 BIRT
2 DATE 1850
0 @I3@ INDI
1 NAME Liv /Livingston/
1 NAME Liv /Zeta/
2 TYPE married
1 BIRT
2 DATE 1985
2 PLAC Perth, Australia
0 @I4@ INDI
1 NAME Noel /Nofacts/
0 @I5@ INDI
1 NAME Pia /Pubforced/
1 BIRT
2 DATE 1990
0 @I6@ INDI
1 NAME Riley /Privateforced/
1 DEAT
2 DATE 1900
0 @I7@ INDI
1 NAME Bef /Beforeman/
1 BIRT
2 DATE BEF 1900
0 @I8@ INDI
1 NAME After /Afterman/
1 BIRT
2 DATE AFT 1900
0 @I9@ INDI
1 NAME Sam /Livingston/
1 DEAT
0 @F1@ FAM
1 HUSB @I1@
1 WIFE @I3@
1 MARR
2 DATE 1990
2 PLAC Marriageton
0 @F2@ FAM
1 HUSB @I1@
1 WIFE @I2@
1 MARR
2 DATE 1870
2 PLAC Hobartville
0 TRLR`;

/** Whether each fixture person is visible to a contributor or viewer, by XREF. */
const VISIBLE: Record<string, boolean> = {
	'@I1@': true, // a burial and no birth
	'@I2@': true, // born 1850
	'@I3@': false, // born 1985
	'@I4@': false, // no facts at all
	'@I5@': true, // born 1990 but forced public
	'@I6@': false, // died 1900 but forced private
	'@I7@': true, // BEF 1900
	'@I8@': false, // AFT 1900
	'@I9@': true // a death
};

let t: TestDatabase;
let treeId: string;
const actors = {} as Record<TreeRole, TestActor>;
let idOf: (xref: string) => string;
const NOW_FN = () => NOW;

const people = (r: { people: Array<{ id: string }> }) => r.people.map((p) => p.id);
const xrefsOf = (ids: string[]) => ids.map((id) => id.split(':')[1]!);

beforeAll(async () => {
	t = await createTestDatabase();
	actors.owner = await createTestUser(t.db, 'owner');
	treeId = await createTestTree(t.db, actors.owner);
	for (const role of ['manager', 'editor', 'contributor', 'viewer'] as const) {
		actors[role] = await createTestUser(t.db, role);
		await addTestMember(t.db, treeId, actors[role], role);
	}
	await importGedcomToDb(t.d1, treeId, FIXTURE, 'Privacy');
	const rows = await t.db
		.select({ id: individuals.id, xref: individuals.xrefId })
		.from(individuals)
		.where(eq(individuals.treeId, treeId));
	const byXref = new Map(rows.map((r) => [r.xref, r.id]));
	idOf = (xref) => byXref.get(xref)!;
	await t.db
		.update(individuals)
		.set({ privacy: 'public' })
		.where(eq(individuals.id, idOf('@I5@')));
	await t.db
		.update(individuals)
		.set({ privacy: 'private' })
		.where(eq(individuals.id, idOf('@I6@')));
}, 60_000);
afterAll(async () => {
	await t.dispose();
});

const search = () => new SearchService(t.db, NOW_FN);
const lists = () => new ListService(t.db, NOW_FN);

describe('the SQL predicate and the pure rule', () => {
	it('agree for every fixture person', async () => {
		const scope = { isRestricted: true, cutoff: CUTOFF, creatorId: null };
		const visible = await visibleAmong(t.db, treeId, Object.keys(VISIBLE).map(idOf), scope);
		for (const [xref, isVisible] of Object.entries(VISIBLE)) {
			const id = idOf(xref);
			const person = (await t.db.select().from(individuals).where(eq(individuals.id, id)))[0]!;
			const facts = (await t.db.select().from(events).where(eq(events.entityId, id))).map((e) => ({
				type: e.type,
				dateSortEnd: e.dateSortEnd
			}));
			expect(!isPersonPrivate(person.privacy, facts, CUTOFF), `pure rule for ${xref}`).toBe(
				isVisible
			);
			expect(visible.has(id), `SQL for ${xref}`).toBe(isVisible);
		}
	});
});

describe('search', () => {
	it.each(['owner', 'manager', 'editor'] as const)('shows %s every person', async (role) => {
		const r = await search().search(treeId, { text: 'Livingston' }, actors[role].context);
		expect(xrefsOf(people(r)).sort()).toEqual(['@I3@', '@I9@']);
	});

	it.each(['contributor', 'viewer'] as const)(
		'hides a private person, their other names and their XREF from a %s',
		async (role) => {
			const ctx = actors[role].context;
			expect(xrefsOf(people(await search().search(treeId, { text: 'Livingston' }, ctx)))).toEqual([
				'@I9@'
			]);
			// A married name and an XREF are other doors to the same person.
			expect((await search().search(treeId, { text: 'Zeta' }, ctx)).people).toEqual([]);
			expect((await search().search(treeId, { text: '@I3@' }, ctx)).people).toEqual([]);
			expect((await search().search(treeId, { place: 'Perth' }, ctx)).people).toEqual([]);
			expect(xrefsOf(people(await search().search(treeId, { text: '@I2@' }, ctx)))).toEqual([
				'@I2@'
			]);
		}
	);

	// A contributor's predicate has a third term (their own people); it must not turn "private" into "unknown".
	it.each(['viewer', 'contributor'] as const)(
		"does not let a private couple's wedding find, or be quoted for, the visible partner of a %s",
		async (role) => {
			const owner = actors.owner.context;
			const viewer = actors[role].context;
			// Dora's partner Liv is private, so the marriage is a fact about Liv too.
			const asOwner = await search().search(treeId, { place: 'Marriageton' }, owner);
			expect(xrefsOf(people(asOwner)).sort()).toEqual(['@I1@', '@I3@']);
			expect(
				asOwner.people
					.flatMap((p) => p.matches)
					.some((m) => m.kind === 'fact' && m.isPartnershipFact)
			).toBe(true);
			for (const query of [
				{ place: 'Marriageton' },
				{ text: 'Deadly', place: 'Marriageton' },
				{ text: '@I1@', place: 'Marriageton' }
			]) {
				const found = await search().search(treeId, query, viewer);
				expect(JSON.stringify(found), JSON.stringify(query)).not.toContain('Marriageton');
				expect(found.people, JSON.stringify(query)).toEqual([]);
			}
			// 1990 is also the year Pia (forced public) was born, so she may match; the wedding must not be what finds Dora.
			const byYear = await search().search(treeId, { from: '1990', to: '1990' }, viewer);
			expect(xrefsOf(people(byYear))).not.toContain('@I1@');
			expect(
				byYear.people
					.flatMap((p) => p.matches)
					.filter((m) => m.kind === 'fact' && m.isPartnershipFact)
			).toEqual([]);
			// A couple who are both visible still match, and say why.
			const visibleCouple = await search().search(treeId, { place: 'Hobartville' }, viewer);
			expect(xrefsOf(people(visibleCouple)).sort()).toEqual(['@I1@', '@I2@']);
			expect(
				visibleCouple.people
					.flatMap((p) => p.matches)
					.some((m) => m.kind === 'fact' && m.isPartnershipFact)
			).toBe(true);
		}
	);

	it('computes hasMore and page fill over what the viewer may see', async () => {
		const ctx = actors.viewer.context;
		const all = await search().search(treeId, { text: 'a', limit: 50 }, ctx);
		const visibleCount = all.people.length;
		expect(visibleCount).toBeGreaterThan(1);
		const first = await search().search(treeId, { text: 'a', limit: visibleCount - 1 }, ctx);
		expect(first.people).toHaveLength(visibleCount - 1);
		expect(first.hasMore).toBe(true);
		const exact = await search().search(treeId, { text: 'a', limit: visibleCount }, ctx);
		expect(exact.hasMore).toBe(false);
	});
});

describe('lists', () => {
	it('lists every person for an owner and only visible people for a viewer, with a matching total', async () => {
		const owner = await lists().individuals(treeId, { limit: 100 }, actors.owner.context);
		const viewer = await lists().individuals(treeId, { limit: 100 }, actors.viewer.context);
		expect(owner.items).toHaveLength(9);
		expect(xrefsOf(viewer.items.map((p) => p.id)).sort()).toEqual(
			Object.entries(VISIBLE)
				.filter(([, isVisible]) => isVisible)
				.map(([x]) => x)
				.sort()
		);
		const paged = await lists().individuals(treeId, { limit: 2, offset: 0 }, actors.viewer.context);
		expect(paged.items).toHaveLength(2);
		expect(paged.hasMore).toBe(true);
	});

	it("drops a private person's surname from the surname list and discounts the count", async () => {
		const owner = await lists().surnames(treeId, { limit: 100 }, actors.owner.context);
		const viewer = await lists().surnames(treeId, { limit: 100 }, actors.viewer.context);
		const count = (page: typeof owner, name: string) =>
			page.items.find((s) => s.surname === name)?.people;
		expect(count(owner, 'Livingston')).toBe(2);
		expect(count(viewer, 'Livingston')).toBe(1);
		for (const hidden of ['Nofacts', 'Privateforced', 'Afterman', 'Zeta']) {
			expect(count(owner, hidden), `owner sees ${hidden}`).toBeDefined();
			expect(count(viewer, hidden), `viewer sees ${hidden}`).toBeUndefined();
		}
		// The count equals the rows of the filtered list, for the viewer too.
		const filtered = await lists().individuals(
			treeId,
			{ surname: 'Livingston', limit: 100 },
			actors.viewer.context
		);
		expect(filtered.items).toHaveLength(1);
	});

	it('omits a partnership that has a private partner, with its marriage facts', async () => {
		const owner = await lists().unions(treeId, { limit: 100 }, actors.owner.context);
		const viewer = await lists().unions(treeId, { limit: 100 }, actors.viewer.context);
		expect(owner.items).toHaveLength(2);
		expect(viewer.items).toHaveLength(1);
		expect(viewer.items[0]!.marriageDate).toBe('1870');
	});
});

describe('favourites and recents', () => {
	it('answer for a private person exactly as for one that does not exist', async () => {
		const marks = new MarkService(t.db, () => Date.now());
		const ctx = actors.contributor.context;
		const hidden = await marks.addFavorite(treeId, idOf('@I3@'), ctx).catch((e) => e);
		const missing = await marks.addFavorite(treeId, 'no-such-person', ctx).catch((e) => e);
		expect(hidden).toBeInstanceOf(NotFoundError);
		expect(missing).toBeInstanceOf(NotFoundError);
		expect({ ...hidden, message: hidden.message.replace(idOf('@I3@'), 'ID') }).toEqual({
			...missing,
			message: missing.message.replace('no-such-person', 'ID')
		});
	});

	it("drop a person who became private from a contributor's list but keep them for an owner", async () => {
		const marks = new MarkService(t.db, () => Date.now());
		const owner = actors.owner.context;
		const contributor = actors.contributor.context;
		await marks.addFavorite(treeId, idOf('@I2@'), contributor);
		await marks.addFavorite(treeId, idOf('@I2@'), owner);
		expect((await marks.get(treeId, contributor)).favorites.map((p) => p.id)).toContain(
			idOf('@I2@')
		);
		await t.db
			.update(individuals)
			.set({ privacy: 'private' })
			.where(eq(individuals.id, idOf('@I2@')));
		expect((await marks.get(treeId, contributor)).favorites).toEqual([]);
		expect((await marks.get(treeId, owner)).favorites.map((p) => p.id)).toContain(idOf('@I2@'));
		await t.db
			.update(individuals)
			.set({ privacy: 'auto' })
			.where(eq(individuals.id, idOf('@I2@')));
	});
});
