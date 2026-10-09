/**
 * The whole-tree read (`scope=all`) is a new way to reach every relative, so it joins the privacy
 * matrix (ADR-015): a restricted viewer is sent no more through it than through the focus window,
 * and the cap and `isTruncated` say nothing about people they cannot see.
 */

import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { individuals, trees } from '../db/schema';
import { GraphWindowRepository } from '../repositories/graph-window-repository';
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
import { loadWholeTreeWindow } from './whole-tree-window';

const NOW = new Date('2026-10-01T12:00:00Z');

const dead = (year: number, died: number) => `1 BIRT\n2 DATE ${year}\n1 DEAT\n2 DATE ${died}\n`;

/**
 * Two families with nothing between them. The Linnets: Old and Olga had Mid; Mid and Wed had Kid
 * (living, so private to a viewer) and Teen (visible). The Marrows are a dead couple and their
 * child, with no link to the Linnets, and one living stranger with no links at all.
 */
const FIXTURE = `0 HEAD
0 @I1@ INDI
1 NAME Old /Linnet/
${dead(1850, 1920)}1 FAMS @F1@
0 @I2@ INDI
1 NAME Olga /Linnet/
${dead(1855, 1925)}1 FAMS @F1@
0 @I3@ INDI
1 NAME Mid /Linnet/
${dead(1880, 1950)}1 FAMC @F1@
1 FAMS @F2@
0 @I4@ INDI
1 NAME Wed /Linnet/
${dead(1882, 1955)}1 FAMS @F2@
0 @I5@ INDI
1 NAME Secretkid /Hiddenson/
1 BIRT
2 DATE 2001
1 FAMC @F2@
0 @I6@ INDI
1 NAME Teen /Linnet/
${dead(1910, 1990)}1 FAMC @F2@
0 @I7@ INDI
1 NAME Max /Marrow/
${dead(1700, 1770)}1 FAMS @F3@
0 @I8@ INDI
1 NAME Mia /Marrow/
${dead(1702, 1775)}1 FAMS @F3@
0 @I9@ INDI
1 NAME Moe /Marrow/
${dead(1730, 1800)}1 FAMC @F3@
0 @I10@ INDI
1 NAME Stranger /Livingson/
1 BIRT
2 DATE 1999
0 @F1@ FAM
1 HUSB @I1@
1 WIFE @I2@
1 CHIL @I3@
0 @F2@ FAM
1 HUSB @I3@
1 WIFE @I4@
1 CHIL @I5@
1 CHIL @I6@
0 @F3@ FAM
1 HUSB @I7@
1 WIFE @I8@
1 CHIL @I9@
0 TRLR`;

const SECRETS = ['Secretkid', 'Hiddenson', 'Stranger', 'Livingson'];
const VISIBLE_NAMES = ['Old', 'Olga', 'Mid', 'Wed', 'Teen', 'Max', 'Mia', 'Moe'];

let t: TestDatabase;
let treeId: string;
const actors = {} as Record<'owner' | 'viewer', TestActor>;
const service = () => new GraphQueryService(t.db, () => NOW);

beforeAll(async () => {
	t = await createTestDatabase();
	actors.owner = await createTestUser(t.db, 'owner');
	treeId = await createTestTree(t.db, actors.owner);
	actors.viewer = await createTestUser(t.db, 'viewer');
	await addTestMember(t.db, treeId, actors.viewer, 'viewer');
	await importGedcomToDb(t.d1, treeId, FIXTURE, 'Whole tree');
}, 60_000);
afterAll(async () => {
	await t.dispose();
});

const names = (r: Awaited<ReturnType<GraphQueryService['wholeTreeGraph']>>) =>
	r.graph.people.map((p) => p.displayName);

describe('the whole tree, for a role that sees everyone', () => {
	it('includes unconnected families and everyone, with no focus', async () => {
		const r = await service().wholeTreeGraph(treeId, actors.owner.context);
		expect(r).toMatchObject({ focusPersonId: null, isWholeTree: true, isTruncated: false });
		expect(r.drawnPersonIds).toHaveLength(10);
		for (const name of [...VISIBLE_NAMES, 'Secretkid', 'Stranger'])
			expect(
				names(r).some((n) => n.startsWith(name)),
				name
			).toBe(true);
		expect(r.drawnUnionIds).toHaveLength(3);
		expect(r.graph.people.every((p) => p.isPartial !== true)).toBe(true);
	});
});

describe.each([false, true])('a restricted viewer, placeholders %s', (hasPlaceholders) => {
	beforeAll(async () => {
		await t.db
			.update(trees)
			.set({ shouldShowPrivateStructure: hasPlaceholders })
			.where(eq(trees.id, treeId));
	});

	it('is sent nothing a private person owns, and still the unconnected visible family', async () => {
		const r = await service().wholeTreeGraph(treeId, actors.viewer.context);
		expect(SECRETS.filter((s) => JSON.stringify(r).includes(s))).toEqual([]);
		for (const name of VISIBLE_NAMES) expect(names(r).some((n) => n.startsWith(name))).toBe(true);
		const hidden = await t.db
			.select({ id: individuals.id, name: individuals.givenName })
			.from(individuals)
			.where(eq(individuals.treeId, treeId));
		const hiddenIds = hidden.filter((h) => SECRETS.includes(h.name ?? '')).map((h) => h.id);
		expect(hiddenIds).toHaveLength(2);
		if (hasPlaceholders) {
			// Structure stays, anonymously: the two private people are placeholders.
			const placeholders = r.graph.people.filter((p) => p.isPrivate === true);
			expect(placeholders.map((p) => p.displayName)).toEqual(['Private', 'Private']);
		} else {
			expect(hiddenIds.filter((id) => JSON.stringify(r).includes(id))).toEqual([]);
			expect(r.graph.people.some((p) => p.isPrivate === true)).toBe(false);
		}
	});

	it('is not truncated by people it cannot see', async () => {
		// The viewer sees 8 people (10 with placeholders). A cap of exactly that is not exceeded,
		// whatever else the tree holds; the owner, who sees 10, is truncated by the same cap.
		const visibleCount = hasPlaceholders ? 10 : 8;
		const scope = {
			cutoff: new Date(NOW.getTime() - 100 * 365.25 * 24 * 3600 * 1000).toISOString(),
			shouldShowPrivateStructure: hasPlaceholders,
			creatorId: null
		};
		const repo = new GraphWindowRepository(t.db);
		const asViewer = await loadWholeTreeWindow(repo, treeId, scope, visibleCount);
		expect(asViewer.isTruncated).toBe(false);
		expect(asViewer.personIds).toHaveLength(visibleCount);
		const asOwner = await loadWholeTreeWindow(repo, treeId, undefined, 8);
		expect(asOwner.isTruncated).toBe(true);
	});
});

describe('the cap', () => {
	it('keeps the first people in the tree, says so, and names the rest only as neighbours', async () => {
		const repo = new GraphWindowRepository(t.db);
		const r = await loadWholeTreeWindow(repo, treeId, undefined, 4);
		expect(r.isTruncated).toBe(true);
		expect(r.personIds).toHaveLength(4);
		const complete = r.graph.people.filter((p) => p.isPartial !== true).map((p) => p.id);
		expect(complete.sort()).toEqual([...r.personIds].sort());
		// Somebody past the cap who a kept person is linked to is named, but marked as not loaded.
		expect(r.graph.people.some((p) => p.isPartial === true)).toBe(true);
	});

	it('pages through a tree larger than one page, in order, and stops at the cap', async () => {
		const owner = await createTestUser(t.db, 'big');
		const big = await createTestTree(t.db, owner);
		const lines = ['0 HEAD'];
		for (let i = 0; i < 620; i++)
			lines.push(
				`0 @I${i}@ INDI`,
				`1 NAME P${i} /Bulk/`,
				'1 BIRT',
				'2 DATE 1800',
				'1 DEAT',
				'2 DATE 1860'
			);
		lines.push('0 TRLR');
		await importGedcomToDb(t.d1, big, lines.join('\n'), 'Bulk');
		const repo = new GraphWindowRepository(t.db);
		const all = await loadWholeTreeWindow(repo, big, undefined, 3000);
		expect(all.personIds).toHaveLength(620);
		expect(all.isTruncated).toBe(false);
		const capped = await loadWholeTreeWindow(repo, big, undefined, 300);
		expect(capped.personIds).toEqual(all.personIds.slice(0, 300));
		expect(capped.isTruncated).toBe(true);
	}, 60_000);
});
