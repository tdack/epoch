/**
 * The wider focus graph of the 3D views (`side` and `origins`) is a new way to reach relatives, so
 * it joins the privacy matrix (ADR-015): a restricted viewer must be sent no more through it than
 * through the hourglass. The tree is built so every new group holds both a visible and a private
 * person, and a string only a private record contains must appear nowhere in what they are sent.
 */

import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { individuals, trees } from '../db/schema';
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

const NOW = new Date('2026-10-01T12:00:00Z');

/**
 * Frank's grandparents had Gus (his father), Ada (an aunt, visible) and Livingstone (an uncle, still
 * living, so private). Ada's children are Cora (visible) and Dina (living, private). Frank's wife
 * Wilma has parents Pa (visible) and Ma (living, private), a visible brother Wally and a living
 * sister Skye (private).
 */
const FIXTURE = `0 HEAD
0 @I1@ INDI
1 NAME Frank /Focal/
1 BIRT
2 DATE 1900
1 DEAT
2 DATE 1980
1 FAMC @F1@
1 FAMS @F5@
0 @I2@ INDI
1 NAME Gus /Focal/
1 BIRT
2 DATE 1870
1 DEAT
2 DATE 1940
1 FAMC @F0@
1 FAMS @F1@
0 @I3@ INDI
1 NAME Mara /Focal/
1 BIRT
2 DATE 1875
1 DEAT
2 DATE 1945
1 FAMS @F1@
0 @I4@ INDI
1 NAME Ada /Focal/
1 BIRT
2 DATE 1872
1 DEAT
2 DATE 1950
1 FAMC @F0@
1 FAMS @F2@
0 @I5@ INDI
1 NAME Livingstone /Secretson/
1 BIRT
2 DATE 1990
1 FAMC @F0@
0 @I6@ INDI
1 NAME Bert /Marryat/
1 BIRT
2 DATE 1870
1 DEAT
2 DATE 1960
1 FAMS @F2@
0 @I7@ INDI
1 NAME Cora /Cousin/
1 BIRT
2 DATE 1900
1 DEAT
2 DATE 1970
1 FAMC @F2@
0 @I8@ INDI
1 NAME Dina /Hiddenwyn/
1 BIRT
2 DATE 1995
1 FAMC @F2@
0 @I9@ INDI
1 NAME Wilma /Wedded/
1 BIRT
2 DATE 1902
1 DEAT
2 DATE 1985
1 FAMC @F4@
1 FAMS @F5@
0 @I10@ INDI
1 NAME Pa /Wedded/
1 BIRT
2 DATE 1870
1 DEAT
2 DATE 1930
1 FAMS @F4@
0 @I11@ INDI
1 NAME Maxine /Privatey/
1 BIRT
2 DATE 1992
1 FAMS @F4@
0 @I12@ INDI
1 NAME Wally /Wedded/
1 BIRT
2 DATE 1905
1 DEAT
2 DATE 1990
1 FAMC @F4@
0 @I13@ INDI
1 NAME Skye /Concealed/
1 BIRT
2 DATE 1996
1 FAMC @F4@
0 @I14@ INDI
1 NAME Old /Gramps/
1 BIRT
2 DATE 1840
1 DEAT
2 DATE 1900
1 FAMS @F0@
0 @I15@ INDI
1 NAME Older /Gran/
1 BIRT
2 DATE 1845
1 DEAT
2 DATE 1905
1 FAMS @F0@
0 @F0@ FAM
1 HUSB @I14@
1 WIFE @I15@
1 CHIL @I2@
1 CHIL @I4@
1 CHIL @I5@
0 @F1@ FAM
1 HUSB @I2@
1 WIFE @I3@
1 CHIL @I1@
0 @F2@ FAM
1 HUSB @I6@
1 WIFE @I4@
1 CHIL @I7@
1 CHIL @I8@
0 @F4@ FAM
1 HUSB @I10@
1 WIFE @I11@
1 CHIL @I9@
1 CHIL @I12@
1 CHIL @I13@
0 @F5@ FAM
1 HUSB @I1@
1 WIFE @I9@
0 TRLR`;

const PRIVATE_XREFS = ['@I5@', '@I8@', '@I11@', '@I13@'];
const VISIBLE_XREFS = ['@I4@', '@I6@', '@I7@', '@I9@', '@I10@', '@I12@'];
const SECRETS = ['Livingstone', 'Secretson', 'Dina', 'Hiddenwyn', 'Maxine', 'Privatey', 'Skye'];

const WIDE = {
	ancestorDepth: 3,
	descendantDepth: 3,
	shouldIncludeSiblings: true,
	shouldIncludeStepFamilies: true,
	collateralDepth: 2,
	shouldIncludePartnerOrigins: true
};

let t: TestDatabase;
let treeId: string;
const actors = {} as Record<TreeRole, TestActor>;
let idOf: (xref: string) => string;
const graph = () => new GraphQueryService(t.db, () => NOW);

async function setPlaceholders(isOn: boolean) {
	await t.db.update(trees).set({ shouldShowPrivateStructure: isOn }).where(eq(trees.id, treeId));
}

beforeAll(async () => {
	t = await createTestDatabase();
	actors.owner = await createTestUser(t.db, 'owner');
	treeId = await createTestTree(t.db, actors.owner);
	for (const role of ['editor', 'contributor', 'viewer'] as const) {
		actors[role] = await createTestUser(t.db, role);
		await addTestMember(t.db, treeId, actors[role], role);
	}
	await importGedcomToDb(t.d1, treeId, FIXTURE, 'Wide focus');
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

const idsIn = (r: Awaited<ReturnType<GraphQueryService['focusGraph']>>) =>
	new Set(r.graph.people.map((p) => p.id));

describe('the control: roles that see everyone', () => {
	it.each(['owner', 'editor'] as const)(
		'%s reaches every group, private people included',
		async (role) => {
			const r = await graph().focusGraph(treeId, idOf('@I1@'), WIDE, actors[role].context);
			const ids = idsIn(r);
			for (const xref of [...PRIVATE_XREFS, ...VISIBLE_XREFS]) {
				expect(ids.has(idOf(xref)), xref).toBe(true);
			}
		}
	);

	it('loads the wider groups in full, and only when the options ask for them', async () => {
		const read = (options: typeof WIDE) =>
			graph().focusGraph(treeId, idOf('@I1@'), options, actors.owner.context);
		const isLoaded = (r: Awaited<ReturnType<typeof read>>, xref: string) =>
			r.graph.people.some((p) => p.id === idOf(xref) && p.isPartial !== true);
		const wide = await read(WIDE);
		const narrow = await read({ ...WIDE, collateralDepth: 0, shouldIncludePartnerOrigins: false });
		// The window holds partial neighbours of what it draws, so "drawn" means "loaded in full".
		for (const xref of ['@I4@', '@I7@', '@I10@', '@I12@']) {
			expect(isLoaded(wide, xref), `${xref} with the options`).toBe(true);
			expect(isLoaded(narrow, xref), `${xref} without them`).toBe(false);
		}
	});
});

describe.each([false, true])('a restricted viewer, placeholders %s', (hasPlaceholders) => {
	beforeAll(() => setPlaceholders(hasPlaceholders));

	it.each(['contributor', 'viewer'] as const)(
		'%s: side and origins carry nothing private',
		async (role) => {
			const r = await graph().focusGraph(treeId, idOf('@I1@'), WIDE, actors[role].context);
			const text = JSON.stringify(r);
			expect(SECRETS.filter((s) => text.includes(s))).toEqual([]);
			if (!hasPlaceholders) {
				// A private id left in a link, a partner list or a stub would be a leak as well.
				expect(PRIVATE_XREFS.map(idOf).filter((id) => text.includes(id))).toEqual([]);
			}
			const ids = idsIn(r);
			// Not vacuous: the visible people of every new group are there.
			for (const xref of VISIBLE_XREFS) expect(ids.has(idOf(xref)), xref).toBe(true);
			for (const xref of PRIVATE_XREFS) {
				if (hasPlaceholders) {
					const person = r.graph.people.find((p) => p.id === idOf(xref));
					expect(person, xref).toMatchObject({ displayName: 'Private', isPrivate: true });
				} else {
					expect(ids.has(idOf(xref)), xref).toBe(false);
				}
			}
		}
	);

	it.each(['contributor', 'viewer'] as const)(
		'%s: a stub counts a private relative only when placeholders are on',
		async (role) => {
			// One side branch deep, so Ada's children stay behind a stub that counts Cora and Dina.
			const options = { ...WIDE, collateralDepth: 1 };
			const total = async (as: TreeRole) =>
				(await graph().focusGraph(treeId, idOf('@I1@'), options, actors[as].context)).stubs.reduce(
					(n, s) => n + s.count,
					0
				);
			const everyone = await total('owner');
			// Dina is Ada's private child, and so is Livingstone's absence from the walk: only Dina counts.
			expect(await total(role)).toBe(hasPlaceholders ? everyone : everyone - 1);
		}
	);

	it('answers for a private person exactly as for one that does not exist, with the options on', async () => {
		const ctx = actors.viewer.context;
		const hidden = await graph()
			.focusGraph(treeId, idOf('@I5@'), WIDE, ctx)
			.catch((e) => e);
		const missing = await graph()
			.focusGraph(treeId, 'no-such-person', WIDE, ctx)
			.catch((e) => e);
		expect(hidden.constructor).toBe(missing.constructor);
		expect(hidden.message.replace(idOf('@I5@'), 'ID')).toBe(
			missing.message.replace('no-such-person', 'ID')
		);
	});
});
