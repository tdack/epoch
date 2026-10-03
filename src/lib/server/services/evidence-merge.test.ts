/**
 * A merge never drops a citation (ADR-028): whatever a record cited is still cited after it is
 * folded into another, by the record that now says the same thing, and an undo puts it all back.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { events } from '../db/schema';
import { ChangeStore } from '../repositories/change-store';
import { buildGedcom551String } from '../gedcom/serializer';
import { getTreeExportData, importGedcomToDb } from '../testing/gedcom';
import {
	createTestDatabase,
	createTestUser,
	type TestActor,
	type TestDatabase
} from '../testing/d1';
import { ChangeLogService } from './change-log-service';
import { FactService } from './fact-service';
import { PersonMergeService } from './person-merge-service';
import { RelationshipService } from './relationship-service';

const PEOPLE = `0 HEAD
0 @S1@ SOUR
1 TITL Register A
0 @S2@ SOUR
1 TITL Register B
0 @I1@ INDI
1 NAME Ann /Ash/
2 SOUR @S1@
3 PAGE s-name
1 SEX F
1 SOUR @S1@
2 PAGE s-person
1 BIRT
2 DATE 1900
2 SOUR @S1@
3 PAGE s-birth
1 OCCU Weaver
2 SOUR @S1@
3 PAGE s-occu
1 FAMC @F1@
2 SOUR @S1@
3 PAGE s-link
0 @I2@ INDI
1 NAME Ann /Ash/
2 SOUR @S2@
3 PAGE m-name
1 NAME Ann /Birch/
2 TYPE married
2 SOUR @S2@
3 PAGE m-married
1 SEX F
1 SOUR @S2@
2 PAGE m-person
1 BIRT
2 DATE 1900
2 SOUR @S2@
3 PAGE m-birth
1 DEAT
2 DATE 1980
2 SOUR @S2@
3 PAGE m-death
1 RESI Leeds
2 SOUR @S2@
3 PAGE m-resi
1 FAMC @F1@
2 SOUR @S2@
3 PAGE m-link
0 @I3@ INDI
1 NAME Pa /Ash/
1 FAMS @F1@
0 @F1@ FAM
1 HUSB @I3@
1 CHIL @I1@
1 CHIL @I2@
0 TRLR`;

const UNIONS = `0 HEAD
0 @S1@ SOUR
1 TITL Register A
0 @I1@ INDI
1 NAME Xan /Ash/
1 FAMS @F1@
1 FAMS @F2@
1 FAMS @F3@
0 @I2@ INDI
1 NAME Yve /Birch/
1 FAMS @F1@
1 FAMS @F2@
1 FAMS @F3@
0 @F1@ FAM
1 HUSB @I1@
1 WIFE @I2@
1 MARR
2 DATE 1900
2 SOUR @S1@
3 PAGE f1-marr
1 SOUR @S1@
2 PAGE f1-fam
0 @F2@ FAM
1 HUSB @I1@
1 WIFE @I2@
1 MARR
2 DATE 1900
2 SOUR @S1@
3 PAGE f2-marr
1 DIV
2 DATE 1920
2 SOUR @S1@
3 PAGE f2-div
1 SOUR @S1@
2 PAGE f2-fam
0 @F3@ FAM
1 HUSB @I1@
1 WIFE @I2@
1 MARR
2 DATE 1905
2 SOUR @S1@
3 PAGE f3-marr
0 TRLR`;

let t: TestDatabase;
let actor: TestActor;
beforeAll(async () => {
	t = await createTestDatabase();
	actor = await createTestUser(t.db, 'owner');
});
afterAll(async () => {
	await t.dispose();
});

/** Every citation as it is stored, minus what any touch changes, keyed by id. */
async function citationRows(treeId: string) {
	const rows = await new ChangeStore(t.db).loadRows(treeId);
	return Object.fromEntries(
		rows.citations.map(({ version: _v, updatedAt: _u, ...rest }) => [rest.id, rest])
	);
}

const pages = (rows: Awaited<ReturnType<typeof citationRows>>) =>
	Object.values(rows)
		.map((c) => c.page)
		.sort();

describe('merging two records of one person', () => {
	async function setup() {
		const treeId = crypto.randomUUID();
		await t.d1.prepare('insert into trees (id, name) values (?1, ?2)').bind(treeId, 't').run();
		await t.d1
			.prepare('insert into tree_memberships (id, tree_id, user_id, role) values (?1, ?2, ?3, ?4)')
			.bind(crypto.randomUUID(), treeId, actor.userId, 'owner')
			.run();
		await importGedcomToDb(t.d1, treeId, PEOPLE, 'People', 'merge');
		return { treeId, survivor: `${treeId}:@I1@`, merged: `${treeId}:@I2@`, ctx: actor.context };
	}

	it('keeps every citation, on the record that now says the same thing, and undo restores them', async () => {
		const { treeId, survivor, merged, ctx } = await setup();
		const before = await citationRows(treeId);
		expect(Object.keys(before)).toHaveLength(12);

		const preview = await new PersonMergeService(t.db).preview(
			treeId,
			{ survivorId: survivor, mergedId: merged },
			ctx
		);
		expect(preview.carriedCitations).toBe(7);

		await new PersonMergeService(t.db).merge(
			treeId,
			{ survivorId: survivor, mergedId: merged },
			ctx
		);
		const after = await citationRows(treeId);
		expect(pages(after)).toEqual(pages(before));

		const stored = await new ChangeStore(t.db).loadRows(treeId);
		const subjectOf = (page: string) => {
			const c = Object.values(after).find((row) => row.page === page)!;
			return { kind: c.subjectKind, id: c.subjectId };
		};
		// Every citation points at a record that exists.
		for (const c of Object.values(after)) {
			const owners = {
				person: stored.individuals,
				name: stored.personNames,
				event: stored.events,
				union: stored.unions,
				parent_child: stored.parentChild
			}[c.subjectKind] as Array<{ id: string }>;
			expect(
				owners.some((row) => row.id === c.subjectId),
				c.page ?? ''
			).toBe(true);
		}
		// The duplicate name, birth and link hand theirs to the survivor's.
		const survivorName = stored.personNames.find(
			(n) => n.personId === survivor && n.surname === 'Ash'
		)!;
		expect(subjectOf('m-name').id).toBe(survivorName.id);
		const survivorBirth = stored.events.find((e) => e.entityId === survivor && e.type === 'BIRT')!;
		expect(subjectOf('m-birth').id).toBe(survivorBirth.id);
		expect(subjectOf('s-birth').id).toBe(survivorBirth.id);
		const link = stored.parentChild.find((l) => l.childId === survivor)!;
		expect(subjectOf('m-link').id).toBe(link.id);
		// A moved name and fact keep theirs; the death, written anew, hands over to the new row.
		expect(subjectOf('m-person')).toEqual({ kind: 'person', id: survivor });
		const death = stored.events.find((e) => e.entityId === survivor && e.type === 'DEAT')!;
		expect(subjectOf('m-death').id).toBe(death.id);
		const resi = stored.events.find((e) => e.entityId === survivor && e.type === 'RESI')!;
		expect(subjectOf('m-resi').id).toBe(resi.id);
		const married = stored.personNames.find((n) => n.surname === 'Birch')!;
		expect(married.personId).toBe(survivor);
		expect(subjectOf('m-married').id).toBe(married.id);

		// Citations of one record stay in a strict order.
		const bySubject = new Map<string, number[]>();
		for (const c of Object.values(after))
			bySubject.set(`${c.subjectKind}|${c.subjectId}`, [
				...(bySubject.get(`${c.subjectKind}|${c.subjectId}`) ?? []),
				c.sortOrder
			]);
		for (const orders of bySubject.values())
			expect([...orders].sort()).toEqual([...new Set(orders)].sort());

		await new ChangeLogService(t.db).undoLast(treeId, ctx);
		expect(await citationRows(treeId)).toEqual(before);
	});

	it('keeps a citation through an edit of its fact, and through undo of that edit', async () => {
		const { treeId, survivor, ctx } = await setup();
		const birth = (
			await t.db.select().from(events).where(eq(events.entityId, survivor)).all()
		).find((e) => e.type === 'BIRT')!;
		const before = await citationRows(treeId);
		await new FactService(t.db).update(treeId, birth.id, { place: 'Leeds' }, birth.version, ctx);
		expect(await citationRows(treeId)).toEqual(before);
		await new ChangeLogService(t.db).undoLast(treeId, ctx);
		expect(await citationRows(treeId)).toEqual(before);
	});

	it('exports every citation after the merge', async () => {
		const { treeId, survivor, merged, ctx } = await setup();
		await new PersonMergeService(t.db).merge(
			treeId,
			{ survivorId: survivor, mergedId: merged },
			ctx
		);
		const text = buildGedcom551String(await getTreeExportData(t.d1, treeId));
		for (const page of [
			'm-name',
			'm-married',
			'm-person',
			'm-birth',
			'm-death',
			'm-resi',
			'm-link'
		])
			expect(text, page).toContain(`PAGE ${page}`);
	});
});

describe('merging partnerships', () => {
	async function setup() {
		const treeId = crypto.randomUUID();
		await t.d1.prepare('insert into trees (id, name) values (?1, ?2)').bind(treeId, 't').run();
		await t.d1
			.prepare('insert into tree_memberships (id, tree_id, user_id, role) values (?1, ?2, ?3, ?4)')
			.bind(crypto.randomUUID(), treeId, actor.userId, 'owner')
			.run();
		await importGedcomToDb(t.d1, treeId, UNIONS, 'Unions', 'merge');
		return {
			treeId,
			f1: `${treeId}:@F1@`,
			f2: `${treeId}:@F2@`,
			f3: `${treeId}:@F3@`,
			ctx: actor.context
		};
	}

	it('keeps every citation of the partnerships it folds, and undo restores them', async () => {
		const { treeId, f1, f2, ctx } = await setup();
		const before = await citationRows(treeId);
		expect(Object.keys(before)).toHaveLength(6);
		const service = new RelationshipService(t.db);
		const command = {
			kind: 'merge_unions' as const,
			survivorId: f1,
			mergedIds: [f2],
			// F2 ended in a divorce, F1 did not: keep F1's status.
			keep: { status: f1 }
		};
		const preview = await service.previewMerge(treeId, command, ctx);
		expect(preview.impact?.carriedCitations).toBe(3);

		await service.mergeUnions(treeId, command, ctx);
		const after = await citationRows(treeId);
		expect(pages(after)).toEqual(pages(before));
		const stored = await new ChangeStore(t.db).loadRows(treeId);
		const subjectOf = (page: string) => {
			const c = Object.values(after).find((row) => row.page === page)!;
			return { kind: c.subjectKind, id: c.subjectId };
		};
		const marriage = stored.events.find((e) => e.entityId === f1 && e.type === 'MARR')!;
		expect(subjectOf('f2-marr')).toEqual({ kind: 'event', id: marriage.id });
		expect(subjectOf('f1-marr')).toEqual({ kind: 'event', id: marriage.id });
		const divorce = stored.events.find((e) => e.entityId === f1 && e.type === 'DIV')!;
		expect(subjectOf('f2-div')).toEqual({ kind: 'event', id: divorce.id });
		expect(subjectOf('f2-fam')).toEqual({ kind: 'union', id: f1 });

		await new ChangeLogService(t.db).undoLast(treeId, ctx);
		expect(await citationRows(treeId)).toEqual(before);
	});

	it('keeps the citations of a fact it did not keep, on the partnership', async () => {
		const { treeId, f1, f3, ctx } = await setup();
		const before = await citationRows(treeId);
		const service = new RelationshipService(t.db);
		await service.mergeUnions(
			treeId,
			{
				kind: 'merge_unions',
				survivorId: f1,
				mergedIds: [f3],
				keep: { events: { MARR: f1 } }
			},
			ctx
		);
		const after = await citationRows(treeId);
		expect(pages(after)).toEqual(pages(before));
		const lost = Object.values(after).find((c) => c.page === 'f3-marr')!;
		expect({ kind: lost.subjectKind, id: lost.subjectId }).toEqual({ kind: 'union', id: f1 });
		await new ChangeLogService(t.db).undoLast(treeId, ctx);
		expect(await citationRows(treeId)).toEqual(before);
	});
});
