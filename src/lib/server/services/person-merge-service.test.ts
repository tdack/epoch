/**
 * Merging two records of one person (ADR-022) over a real database: the rows before a merge and
 * after its undo are the same rows, nothing is lost to a cascade, the rights are an editor's, and
 * the file written afterwards points at nothing that is gone.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { personMarks } from '../db/schema';
import {
	ConcurrencyConflictError,
	NotFoundError,
	PersonMergeConflictError,
	UnauthorizedError,
	ValidationError
} from '../domain/errors';
import type { TreeRole } from '../../shared/roles';
import { buildGedcom551String } from '../gedcom/serializer';
import { getTreeExportData, importGedcomToDb } from '../testing/gedcom';
import { ChangeStore } from '../repositories/change-store';
import {
	addTestMember,
	createTestDatabase,
	createTestTree,
	createTestUser,
	type TestActor,
	type TestDatabase
} from '../testing/d1';
import { ChangeLogService } from './change-log-service';
import { FactService } from './fact-service';
import { MarkService } from './mark-service';
import { PersonMergeService } from './person-merge-service';
import { MAX_PERSON_MERGE_OPS } from '../../shared/person-merge';

/** Ann is entered twice (I1 and I2); Ann's record I2 also carries a married name, a custom tag and a birth that differs. */
const FIXTURE = `0 HEAD
0 @I1@ INDI
1 NAME Ann /Ash/
1 SEX F
1 BIRT
2 DATE 1900
2 PLAC Leeds
1 FAMS @F1@
0 @I2@ INDI
1 NAME Ann /Ash/
1 NAME Ann /Birch/
2 TYPE married
1 SEX F
1 BIRT
2 DATE 1901
2 PLAC Hull
1 _CUSTOM kept on two
1 ASSO @I5@
2 RELA friend
1 FAMC @F2@
1 FAMS @F3@
0 @I3@ INDI
1 NAME Bob /Ash/
1 SEX M
1 FAMS @F1@
0 @I4@ INDI
1 NAME Kit /Ash/
1 FAMC @F1@
0 @I5@ INDI
1 NAME Cy /Ash/
1 SEX M
1 FAMS @F3@
0 @I6@ INDI
1 NAME Mum /Ash/
1 FAMS @F2@
0 @F1@ FAM
1 HUSB @I3@
1 WIFE @I1@
1 CHIL @I4@
0 @F2@ FAM
1 WIFE @I6@
1 CHIL @I2@
0 @F3@ FAM
1 HUSB @I5@
1 WIFE @I2@
0 TRLR`;

let t: TestDatabase;
let treeId: string;
let ann: string;
let annAgain: string;
const actors = {} as Record<TreeRole, TestActor>;
const id = (xref: string) => `${treeId}:${xref}`;
const service = () => new PersonMergeService(t.db);
const rowsNow = async () => {
	const rows = await new ChangeStore(t.db).loadRows(treeId);
	// An undo gives a restored row a version above the live one (so a stale editor cannot match it
	// again), and stamps it anew; everything else about a row must come back as it was.
	const plain = <T extends { id: string }>(row: T) => {
		const {
			version: _v,
			createdAt: _c,
			updatedAt: _u,
			...rest
		} = row as T & { version?: number; createdAt?: unknown; updatedAt?: unknown };
		return rest as unknown as T;
	};
	const byId = <T extends { id: string }>(list: T[]) =>
		list.map(plain).sort((a, b) => a.id.localeCompare(b.id));
	return {
		individuals: byId(rows.individuals),
		personNames: byId(rows.personNames),
		unions: byId(rows.unions),
		unionPartners: byId(rows.unionPartners),
		parentChild: byId(rows.parentChild),
		events: byId(rows.events)
	};
};

beforeAll(async () => {
	t = await createTestDatabase();
	actors.owner = await createTestUser(t.db, 'owner');
	treeId = await createTestTree(t.db, actors.owner);
	for (const role of ['editor', 'contributor', 'viewer'] as const) {
		actors[role] = await createTestUser(t.db, role);
		await addTestMember(t.db, treeId, actors[role], role);
	}
	await importGedcomToDb(t.d1, treeId, FIXTURE, 'Merge');
	ann = id('@I1@');
	annAgain = id('@I2@');
}, 60_000);
afterAll(async () => {
	await t.dispose();
});

describe('the review', () => {
	it('shows both records side by side and says what the result will hold', async () => {
		const review = await service().review(
			treeId,
			{ survivorId: ann, mergedId: annAgain },
			actors.editor.context
		);
		expect(review.refusal).toBeNull();
		expect(review.conflicts).toEqual([]);
		expect(review.survivor.facts.map((f) => f.text)).toContain('1900, Leeds');
		expect(review.merged.facts.map((f) => f.text)).toContain('1901, Hull');
		expect(review.merged.names.map((n) => n.text)).toEqual(['Ann Ash', 'Ann Birch']);
		expect(review.merged.parents.map((p) => p.name)).toEqual(['Mum Ash']);
		expect(review.survivor.partnerships.map((p) => p.partners)).toEqual(['Bob Ash']);
		expect(review.notes.join(' ')).toMatch(/2 births recorded \(1900, 1901\)/);
	});

	it('refuses a pair that cannot be one person, without planning anything', async () => {
		const review = await service().review(
			treeId,
			{ survivorId: ann, mergedId: id('@I3@') },
			actors.editor.context
		);
		expect(review.refusal).toMatch(/partners/);
		expect(review.notes).toEqual([]);
	});

	it('is for editors and above: a contributor and a viewer are refused', async () => {
		for (const who of ['contributor', 'viewer'] as const) {
			await expect(
				service().review(treeId, { survivorId: ann, mergedId: annAgain }, actors[who].context)
			).rejects.toBeInstanceOf(UnauthorizedError);
			await expect(
				service().preview(treeId, { survivorId: ann, mergedId: annAgain }, actors[who].context)
			).rejects.toBeInstanceOf(UnauthorizedError);
			await expect(
				service().merge(treeId, { survivorId: ann, mergedId: annAgain }, actors[who].context)
			).rejects.toBeInstanceOf(UnauthorizedError);
		}
		expect((await rowsNow()).individuals.map((p) => p.id)).toContain(annAgain);
	});
});

describe('merging and undoing', () => {
	it('merges in one change, loses nothing to a cascade, and undo gives back exactly the rows it started with', async () => {
		const before = await rowsNow();
		const marks = new MarkService(t.db);
		await marks.addFavorite(treeId, annAgain, actors.owner.context);
		await marks.addFavorite(treeId, annAgain, actors.editor.context);

		const impact = await service().preview(
			treeId,
			{ survivorId: ann, mergedId: annAgain },
			actors.editor.context
		);
		expect(impact.isDestructive).toBe(true);
		expect(impact.headline).toBe('Merged Ann Ash into Ann Ash');
		const result = await service().merge(
			treeId,
			{ survivorId: ann, mergedId: annAgain, expectedVersions: { [ann]: 1, [annAgain]: 1 } },
			actors.editor.context
		);
		expect(result.change?.summary).toMatch(/^Merged Ann Ash into Ann Ash/);

		const after = await rowsNow();
		expect(after.individuals.map((p) => p.id)).not.toContain(annAgain);
		const survivor = after.individuals.find((p) => p.id === ann)!;
		expect(survivor.xrefAliases).toEqual(['@I2@']);
		expect(
			after.personNames
				.filter((n) => n.personId === ann)
				.map((n) => `${n.givenName} ${n.surname}`)
				.sort()
		).toEqual(['Ann Ash', 'Ann Birch']);
		expect(after.parentChild.filter((l) => l.childId === ann).map((l) => l.parentId)).toEqual([
			id('@I6@')
		]);
		expect(
			after.unionPartners
				.filter((p) => p.personId === ann)
				.map((p) => p.unionId)
				.sort()
		).toEqual([id('@F1@'), id('@F3@')]);
		// Nothing points at the record that is gone, which a cascade would also have achieved by deleting rows.
		expect(after.parentChild.length).toBe(before.parentChild.length);
		expect(after.unionPartners.length).toBe(before.unionPartners.length);
		// In the order the tree stores them, which is what "first birth" means: the survivor's stays first.
		const stored = await new ChangeStore(t.db).loadRows(treeId);
		const births = stored.events.filter((e) => e.entityId === ann && e.type === 'BIRT');
		expect(births.map((b) => b.dateRaw)).toEqual(['1900', '1901']);

		// Favourites are copied, not moved.
		const favourites = await t.db
			.select()
			.from(personMarks)
			.where(and(eq(personMarks.treeId, treeId), eq(personMarks.kind, 'favorite')))
			.all();
		expect(favourites.filter((m) => m.personId === ann)).toHaveLength(2);
		expect(favourites.filter((m) => m.personId === annAgain)).toHaveLength(2);

		await new ChangeLogService(t.db).undoLast(treeId, actors.editor.context);
		expect(await rowsNow()).toEqual(before);
	});

	it('writes a file with no pointer to the merged record, and keeps what was kept under it', async () => {
		await service().merge(treeId, { survivorId: ann, mergedId: annAgain }, actors.owner.context);
		const text = buildGedcom551String(await getTreeExportData(t.d1, treeId)).replace(/\r\n/g, '\n');
		expect(text).not.toContain('@I2@');
		const block = text.split('\n0 ').find((b) => b.startsWith('@I1@'))!;
		expect(block).toContain('_CUSTOM kept on two');
		expect(block).toMatch(/1 ASSO @I5@\n2 RELA friend/);
		expect(block).toContain('2 TYPE married');
		await new ChangeLogService(t.db).undoLast(treeId, actors.owner.context);
	});

	it('asks which sex to keep, refuses a stale version, and names a person who is not there', async () => {
		const first = await service().review(
			treeId,
			{ survivorId: id('@I4@'), mergedId: id('@I5@') },
			actors.owner.context
		);
		expect(first.refusal).toBeNull();
		const kit = await service().review(
			treeId,
			{ survivorId: id('@I5@'), mergedId: id('@I1@') },
			actors.owner.context
		);
		expect(kit.conflicts).toEqual([{ kind: 'sex', survivor: 'M', merged: 'F' }]);
		await expect(
			service().merge(
				treeId,
				{ survivorId: id('@I5@'), mergedId: id('@I1@') },
				actors.owner.context
			)
		).rejects.toBeInstanceOf(PersonMergeConflictError);

		await expect(
			service().merge(
				treeId,
				{ survivorId: ann, mergedId: annAgain, expectedVersions: { [annAgain]: 99 } },
				actors.owner.context
			)
		).rejects.toBeInstanceOf(ConcurrencyConflictError);
		await expect(
			service().merge(treeId, { survivorId: ann, mergedId: 'nobody' }, actors.owner.context)
		).rejects.toBeInstanceOf(NotFoundError);
		await expect(
			service().merge(treeId, { survivorId: ann, mergedId: ann }, actors.owner.context)
		).rejects.toBeInstanceOf(ValidationError);
	});
});

describe('the size limit', () => {
	it('merges and undoes a person with as many records as one change carries, and refuses one more', async () => {
		const owner = await createTestUser(t.db, 'bulk');
		const tree = await createTestTree(t.db, owner);
		await importGedcomToDb(
			t.d1,
			tree,
			'0 HEAD\n0 @A@ INDI\n1 NAME Aye /Bulk/\n0 @B@ INDI\n1 NAME Aye /Bulk/\n0 TRLR',
			'Bulk'
		);
		const [a, b] = [`${tree}:@A@`, `${tree}:@B@`];
		const facts = new FactService(t.db);
		const blank = { dateText: null, place: null, value: null, cause: null, age: null, notes: null };
		// Two person rows, the duplicate name that is dropped, and one op for each moved fact.
		const count = MAX_PERSON_MERGE_OPS - 3;
		for (let i = 0; i < count; i++)
			await facts.create(
				tree,
				b,
				{ ...blank, type: 'RESI', dateText: String(1000 + i), place: `Place ${i % 7}` },
				owner.context
			);
		const store = new ChangeStore(t.db);
		const before = (await store.loadRows(tree)).events.length;

		const merge = new PersonMergeService(t.db);
		await merge.merge(tree, { survivorId: a, mergedId: b }, owner.context);
		const merged = await store.loadRows(tree);
		expect(merged.events.filter((e) => e.entityId === a)).toHaveLength(count);
		await new ChangeLogService(t.db).undoLast(tree, owner.context);
		const restored = await store.loadRows(tree);
		expect(restored.events).toHaveLength(before);
		expect(restored.events.filter((e) => e.entityId === b)).toHaveLength(count);

		await facts.create(tree, b, { ...blank, type: 'RESI', dateText: '999' }, owner.context);
		await expect(merge.merge(tree, { survivorId: a, mergedId: b }, owner.context)).rejects.toThrow(
			/at most/
		);
	}, 240_000);
});
