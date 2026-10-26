/**
 * The living rule as amended on 2026-10-26 (ADR-015): any own fact that ended before the cutoff
 * shows a person, and a tree may keep the recently dead hidden. The SQL predicate, the pure rule
 * and the chart window (which loads only some fact types) must give the same answer.
 */

import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { events, individuals } from '../db/schema';
import type { TreeRole } from '../../shared/roles';
import { isPersonPrivate, livingCutoff } from '../domain/living-state';
import { importGedcomToDb } from '../testing/gedcom';
import { visibleAmong, visibleCounts } from '../repositories/visibility';
import {
	addTestMember,
	createTestDatabase,
	createTestTree,
	createTestUser,
	type TestActor,
	type TestDatabase
} from '../testing/d1';
import { ChartService } from './chart-service';
import { GraphQueryService } from './graph-query-service';

const NOW = new Date('2026-10-01T12:00:00Z');
const CUTOFF = livingCutoff(NOW);
const WINDOW_CUTOFF = livingCutoff(NOW, 120, 20);

const FIXTURE = `0 HEAD
0 @I1@ INDI
1 NAME Cora /Census/
1 CENS
2 DATE 1881
0 @I2@ INDI
1 NAME Rhea /Recent/
1 CENS
2 DATE 2021
0 @I3@ INDI
1 NAME Noel /Nofacts/
0 @I4@ INDI
1 NAME Dan /Diedlately/
1 BIRT
2 DATE 1940
1 DEAT
2 DATE 2015
0 @I5@ INDI
1 NAME Una /Undated/
1 DEAT Y
0 @I6@ INDI
1 NAME Abe /Afterman/
1 DEAT
2 DATE AFT 2000
0 @I7@ INDI
1 NAME Kid /Census/
1 BIRT
2 DATE 1990
1 FAMC @F1@
0 @I8@ INDI
1 NAME Mo /Married/
1 BIRT
2 DATE 1850
0 @F1@ FAM
1 WIFE @I1@
1 CHIL @I7@
0 @F2@ FAM
1 HUSB @I8@
1 WIFE @I3@
0 TRLR`;

/** Who a contributor or viewer may see without the window, then with a 20-year window. */
const VISIBLE: Record<string, [boolean, boolean]> = {
	'@I1@': [true, true], // only a census, in 1881
	'@I2@': [false, false], // only a census, in 2021
	'@I3@': [false, false], // no facts at all
	'@I4@': [true, false], // died 2015
	'@I5@': [true, true], // an undated death counts as long ago
	'@I6@': [true, false], // died AFT 2000: may be recent
	'@I7@': [false, false], // born 1990
	'@I8@': [true, true] // born 1850
};

let t: TestDatabase;
let treeId: string;
const actors = {} as Record<TreeRole, TestActor>;
let idOf: (xref: string) => string;

beforeAll(async () => {
	t = await createTestDatabase();
	actors.owner = await createTestUser(t.db, 'owner');
	treeId = await createTestTree(t.db, actors.owner);
	actors.viewer = await createTestUser(t.db, 'viewer');
	await addTestMember(t.db, treeId, actors.viewer, 'viewer');
	await importGedcomToDb(t.d1, treeId, FIXTURE, 'Living rule');
	const rows = await t.db
		.select({ id: individuals.id, xref: individuals.xrefId })
		.from(individuals)
		.where(eq(individuals.treeId, treeId));
	const byXref = new Map(rows.map((r) => [r.xref, r.id]));
	idOf = (xref) => byXref.get(xref)!;
}, 60_000);
afterAll(async () => {
	await t.dispose();
});

describe('the SQL predicate and the pure rule', () => {
	it.each([
		['without a recent-death window', CUTOFF, 0],
		['with a 20-year window', WINDOW_CUTOFF, 1]
	] as const)('agree for every fixture person %s', async (_name, cutoff, column) => {
		const scope = { isRestricted: true, cutoff, creatorId: null };
		const visible = await visibleAmong(t.db, treeId, Object.keys(VISIBLE).map(idOf), scope);
		for (const [xref, expected] of Object.entries(VISIBLE)) {
			const id = idOf(xref);
			const person = (await t.db.select().from(individuals).where(eq(individuals.id, id)))[0]!;
			const facts = (await t.db.select().from(events).where(eq(events.entityId, id))).map((e) => ({
				type: e.type,
				dateSort: e.dateSort,
				dateSortEnd: e.dateSortEnd
			}));
			expect(!isPersonPrivate(person.privacy, facts, cutoff), `pure rule for ${xref}`).toBe(
				expected[column]
			);
			expect(visible.has(id), `SQL for ${xref}`).toBe(expected[column]);
		}
	});

	it('does not count a partnership whose partner has no facts at all', async () => {
		// Mo is visible and Noel, with no birth row, is not: the partnership is not the viewer's.
		const counts = await visibleCounts(t.db, treeId, {
			isRestricted: true,
			cutoff: CUTOFF,
			creatorId: null
		});
		expect(counts.unions).toBe(1);
	});
});

describe('the chart window', () => {
	it('charts a person a viewer knows only from an old census', async () => {
		const charts = new ChartService(t.db, () => NOW);
		const dto = await charts.pedigree(treeId, idOf('@I1@'), 2, actors.viewer.context);
		expect(dto.slots[0]?.name).toBe('Cora Census');
		expect(dto.slots[0]?.isPrivate).toBe(false);
	});
});

describe('the focus window', () => {
	it('draws a person a viewer knows only from an old census, and not their private child', async () => {
		const graph = new GraphQueryService(t.db, () => NOW);
		const r = await graph.focusGraph(
			treeId,
			idOf('@I1@'),
			{ ancestorDepth: 2, descendantDepth: 2, shouldIncludeSiblings: true },
			actors.viewer.context
		);
		const ids = new Set(r.graph.people.map((p) => p.id));
		expect(ids.has(idOf('@I1@'))).toBe(true);
		expect(ids.has(idOf('@I7@'))).toBe(false);
	});
});
