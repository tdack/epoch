/**
 * What a contributor or viewer can reach of a private person through the record reads (ADR-015):
 * the focus graph, the person page, the partnership page and the header summary, in both
 * placeholder modes. A string that only a private record contains must appear nowhere in what a
 * restricted viewer is sent.
 */

import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { individuals, trees } from '../db/schema';
import { NotFoundError } from '../domain/errors';
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
import { GraphQueryService } from './graph-query-service';
import { PersonPageService } from './person-page-service';
import { UnionPageService } from './union-page-service';

const NOW = new Date('2026-10-01T12:00:00Z');

const FIXTURE = `0 HEAD
0 @I1@ INDI
1 NAME Grandar /Oldman/
1 BIRT
2 DATE 1850
1 FAMS @F1@
1 FAMS @F2@
0 @I2@ INDI
1 NAME Livia /Aliveson/
1 NAME Livia /Zetaman/
2 TYPE married
1 BIRT
2 DATE 1985
2 PLAC Perthville, Australia
1 FAMS @F1@
0 @I3@ INDI
1 NAME Kitt /Oldman/
1 BIRT
2 DATE 1930
1 DEAT
2 DATE 2020
1 FAMC @F1@
1 FAMS @F3@
0 @I4@ INDI
1 NAME Samuel /Passed/
1 DEAT
1 FAMS @F2@
0 @I5@ INDI
1 NAME Tottie /Youngling/
1 BIRT
2 DATE 2015
1 FAMC @F1@
0 @I6@ INDI
1 NAME Orla /Offspring/
1 BIRT
2 DATE 1960
1 DEAT
2 DATE 2022
1 FAMC @F3@
0 @I7@ INDI
1 NAME Parnell /Partner/
1 BIRT
2 DATE 1932
1 DEAT
2 DATE 2019
1 FAMS @F3@
0 @F1@ FAM
1 HUSB @I1@
1 WIFE @I2@
1 CHIL @I3@
1 CHIL @I5@
1 MARR
2 DATE 1990 SEPTEMBER
2 PLAC Marriageton
0 @F2@ FAM
1 HUSB @I1@
1 WIFE @I4@
1 MARR
2 DATE 1875
0 @F3@ FAM
1 HUSB @I7@
1 WIFE @I3@
1 CHIL @I6@
0 TRLR`;

/** Strings that exist only in records a restricted viewer may not see. */
const SECRETS = [
	'Livia',
	'Aliveson',
	'Zetaman',
	'Perthville',
	'Marriageton',
	'Tottie',
	'Youngling',
	'SEPTEMBER'
];

let t: TestDatabase;
let treeId: string;
const actors = {} as Record<TreeRole, TestActor>;
let idOf: (xref: string) => string;
let unionOf: (personXref: string, other: string) => Promise<string>;
const now = () => NOW;

const OPTIONS = {
	ancestorDepth: 3,
	descendantDepth: 3,
	shouldIncludeSiblings: true,
	shouldIncludeStepFamilies: true
};
const graph = () => new GraphQueryService(t.db, now);
const persons = () => new PersonPageService(t.db, now);
const unionsPage = () => new UnionPageService(t.db, now);

async function setPlaceholders(isOn: boolean) {
	await t.db.update(trees).set({ shouldShowPrivateStructure: isOn }).where(eq(trees.id, treeId));
}
// Names and places, and the ids of the private people: an id left in a link, a partner list or a stub is a leak too.
// A placeholder keeps its id so the structure can be drawn, so the ids are only secrets when people are omitted.
const leaks = (value: unknown, areIdsSecret = true) =>
	[...SECRETS, ...(areIdsSecret ? [idOf('@I2@'), idOf('@I5@')] : [])].filter((s) =>
		JSON.stringify(value).includes(s)
	);

beforeAll(async () => {
	t = await createTestDatabase();
	actors.owner = await createTestUser(t.db, 'owner');
	treeId = await createTestTree(t.db, actors.owner);
	for (const role of ['editor', 'contributor', 'viewer'] as const) {
		actors[role] = await createTestUser(t.db, role);
		await addTestMember(t.db, treeId, actors[role], role);
	}
	await importGedcomToDb(t.d1, treeId, FIXTURE, 'Records');
	const rows = await t.db
		.select({ id: individuals.id, xref: individuals.xrefId })
		.from(individuals)
		.where(eq(individuals.treeId, treeId));
	const byXref = new Map(rows.map((r) => [r.xref, r.id]));
	idOf = (xref) => byXref.get(xref)!;
	unionOf = async (a, b) => {
		const r = await t.d1
			.prepare(
				'select u.id id from unions u join union_partners x on x.union_id = u.id join union_partners y on y.union_id = u.id where x.person_id = ?1 and y.person_id = ?2'
			)
			.bind(idOf(a), idOf(b))
			.first<{ id: string }>();
		return r!.id;
	};
}, 60_000);
afterAll(async () => {
	await t.dispose();
});

describe('the control: roles that see everyone', () => {
	it.each(['owner', 'editor'] as const)(
		'%s reads the private people and their facts',
		async (role) => {
			const r = await graph().focusGraph(treeId, idOf('@I1@'), OPTIONS, actors[role].context);
			expect(r.graph.people.map((p) => p.displayName).join('|')).toContain('Livia');
			const union = await unionsPage().getUnion(
				treeId,
				await unionOf('@I1@', '@I2@'),
				actors[role].context
			);
			expect(union.events.map((e) => e.dateText).join()).toContain('1990');
			expect((await graph().summary(treeId, actors[role].context)).counts.people).toBe(7);
		}
	);
});

describe.each([false, true])('a restricted viewer, placeholders %s', (hasPlaceholders) => {
	beforeAll(() => setPlaceholders(hasPlaceholders));

	it.each(['contributor', 'viewer'] as const)(
		'%s: the focus graph carries nothing private',
		async (role) => {
			const r = await graph().focusGraph(treeId, idOf('@I1@'), OPTIONS, actors[role].context);
			expect(leaks(r, !hasPlaceholders)).toEqual([]);
			const ids = r.graph.people.map((p) => p.id);
			expect(ids).toContain(idOf('@I3@'));
			if (hasPlaceholders) {
				const livia = r.graph.people.find((p) => p.id === idOf('@I2@'))!;
				expect(livia).toMatchObject({ displayName: 'Private', isPrivate: true });
			} else {
				expect(ids).not.toContain(idOf('@I2@'));
				expect(ids).not.toContain(idOf('@I5@'));
			}
			// The marriage of a private person is withheld in both modes.
			expect(JSON.stringify(r)).not.toContain('1990');
		}
	);

	it('counts a private child in a stub only when placeholders are on', async () => {
		const options = { ...OPTIONS, descendantDepth: 0 };
		const stubTotal = async (role: TreeRole) =>
			(await graph().focusGraph(treeId, idOf('@I1@'), options, actors[role].context)).stubs.reduce(
				(n, s) => n + s.count,
				0
			);
		const everyone = await stubTotal('owner');
		expect(everyone).toBeGreaterThan(0);
		// Tottie is Grandar's private child: omitted, nobody is counted for her.
		expect(await stubTotal('viewer')).toBe(hasPlaceholders ? everyone : everyone - 1);
	});

	it('answers for a private person exactly as for one that does not exist', async () => {
		const ctx = actors.viewer.context;
		const hidden = await graph()
			.focusGraph(treeId, idOf('@I2@'), OPTIONS, ctx)
			.catch((e) => e);
		const missing = await graph()
			.focusGraph(treeId, 'no-such-person', OPTIONS, ctx)
			.catch((e) => e);
		expect(hidden).toBeInstanceOf(NotFoundError);
		expect(missing).toBeInstanceOf(NotFoundError);
		expect(hidden.message.replace(idOf('@I2@'), 'ID')).toBe(
			missing.message.replace('no-such-person', 'ID')
		);
		const page = await persons()
			.getPerson(treeId, idOf('@I2@'), ctx)
			.catch((e) => e);
		const missingPage = await persons()
			.getPerson(treeId, 'no-such-person', ctx)
			.catch((e) => e);
		expect(page).toBeInstanceOf(NotFoundError);
		expect(page.message.replace(idOf('@I2@'), 'ID')).toBe(
			missingPage.message.replace('no-such-person', 'ID')
		);
		const union = await unionsPage()
			.getUnion(treeId, await unionOf('@I1@', '@I2@'), ctx)
			.catch((e) => e);
		if (hasPlaceholders) {
			// The structure stands, as placeholders, and the wedding's facts stay withheld.
			expect(union.events).toEqual([]);
			expect(leaks(union, false)).toEqual([]);
			expect(union.partners.map((p: { displayName: string }) => p.displayName).sort()).toEqual([
				'Grandar Oldman',
				'Private'
			]);
		} else {
			expect(union).toBeInstanceOf(NotFoundError);
			expect(union.message).toContain('Partnership');
		}
	});

	it('does not link a page to a partnership the viewer cannot open', async () => {
		const unionId = await unionOf('@I1@', '@I2@');
		const page = await persons().getPerson(treeId, idOf('@I1@'), actors.viewer.context);
		const linked = page.partnerships.map((p) => p.unionId);
		// Omitted: the partnership is gone from the page. Placeholders: it is shown and its page opens.
		expect(linked.includes(unionId)).toBe(hasPlaceholders);
	});

	it("shows a visible person's page without the private people around them", async () => {
		const page = await persons().getPerson(treeId, idOf('@I3@'), actors.viewer.context);
		expect(leaks(page, !hasPlaceholders)).toEqual([]);
		expect(page.changes.recent).toEqual([]);
	});

	it('shows a partnership with no private partner, and withholds a private child', async () => {
		const page = await unionsPage().getUnion(
			treeId,
			await unionOf('@I1@', '@I4@'),
			actors.viewer.context
		);
		expect(leaks(page, !hasPlaceholders)).toEqual([]);
		expect(page.partners.map((p) => p.displayName)).toEqual(['Grandar Oldman', 'Samuel Passed']);
	});

	it('counts and defaults over visible people only', async () => {
		const summary = await graph().summary(treeId, actors.viewer.context);
		// Grandar, Kitt, Samuel, Orla and Parnell are visible; Livia and Tottie are private.
		expect(summary.counts.people).toBe(5);
		expect(summary.counts.unions).toBe(2);
		expect([idOf('@I1@'), idOf('@I3@'), idOf('@I4@'), idOf('@I6@'), idOf('@I7@')]).toContain(
			summary.defaultFocusPersonId
		);
	});
});
