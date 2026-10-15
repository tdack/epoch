import { describe, expect, it } from 'vitest';
import {
	describeOps,
	dependentsOfDeletions,
	matchesImage,
	withAllColumns,
	type EventRow,
	type RowOp
} from './change-log';
import { treeRows } from '../testing/rows';

/** An image written before a migration added columns lacks them, which is what these tests are about. */
const oldImage = (image: object) => image as unknown as EventRow;

describe('dependentsOfDeletions', () => {
	const rows = () =>
		treeRows({
			people: [{ id: 'sh' }, { id: 'john' }],
			unions: [{ id: 'u1', partners: ['john', 'sh'] }],
			names: [{ id: 'm', personId: 'sh', type: 'married', surname: 'Smith', unionId: 'u1' }]
		});

	it('names a name that points at a partnership an undo would delete, so the undo is refused', () => {
		const deleteUnion: RowOp[] = [
			{ table: 'unions', id: 'u1', before: rows().unions[0]!, after: null }
		];
		expect(
			dependentsOfDeletions(rows(), deleteUnion).map((d) => [d.table, (d.row as { id: string }).id])
		).toContainEqual(['person_names', 'm']);
	});

	it('does not list a name that the same change deletes, or one linked elsewhere', () => {
		const all = rows();
		const ops: RowOp[] = [
			{ table: 'unions', id: 'u1', before: all.unions[0]!, after: null },
			{ table: 'person_names', id: 'm', before: all.personNames[0]!, after: null }
		];
		expect(dependentsOfDeletions(all, ops).some((d) => d.table === 'person_names')).toBe(false);
	});
});

describe('matchesImage', () => {
	it('compares a row by its columns and not by the order they were written in', () => {
		expect(
			matchesImage(
				{ id: 'a', place: 'Leeds', notes: null },
				{ notes: null, id: 'a', place: 'Leeds' }
			)
		).toBe(true);
	});

	it('treats a key one image lacks as null, so a column added later does not refuse an undo', () => {
		expect(matchesImage({ id: 'a', address: null }, { id: 'a' })).toBe(true);
		expect(matchesImage({ id: 'a', address: '12 High Street' }, { id: 'a' })).toBe(false);
	});

	it('ignores version and timestamps, and notices any other difference', () => {
		expect(
			matchesImage({ id: 'a', version: 1, updatedAt: 1 }, { id: 'a', version: 2, updatedAt: 9 })
		).toBe(true);
		expect(matchesImage({ id: 'a', place: 'Leeds' }, { id: 'a', place: 'Hull' })).toBe(false);
		expect(
			matchesImage({ id: 'a', gedcomExtra: ['2 SOUR @S1@'] }, { id: 'a', gedcomExtra: null })
		).toBe(false);
		expect(matchesImage(null, null)).toBe(true);
		expect(matchesImage({ id: 'a' }, null)).toBe(false);
	});
});

describe('withAllColumns', () => {
	it('fills the keys an image lacks with null and keeps the ones it has', () => {
		expect(withAllColumns({ id: 'a', place: 'Leeds' }, ['id', 'place', 'address'])).toEqual({
			id: 'a',
			place: 'Leeds',
			address: null
		});
	});
});

describe('describeOps across a column added by a migration', () => {
	it('lists no field for a column the old image lacks and the row now holds as null', () => {
		const ops: RowOp[] = [
			{
				table: 'events',
				id: 'e1',
				before: oldImage({ id: 'e1', place: 'Leeds', version: 1 }),
				after: oldImage({ id: 'e1', place: 'Leeds', address: null, version: 2 })
			}
		];
		expect(describeOps(ops, () => 'event')[0]!.fields).toEqual([]);
	});

	it('still lists a real change alongside a column the old image lacks', () => {
		const ops: RowOp[] = [
			{
				table: 'events',
				id: 'e1',
				before: oldImage({ id: 'e1', place: 'Leeds', version: 1 }),
				after: oldImage({ id: 'e1', place: 'Hull', address: null, version: 2 })
			}
		];
		expect(describeOps(ops, () => 'event')[0]!.fields).toEqual([
			{ field: 'place', before: 'Leeds', after: 'Hull' }
		]);
	});
});
