import { describe, expect, it } from 'vitest';
import { dependentsOfDeletions, matchesImage, type RowOp } from './change-log';
import { treeRows } from '../testing/rows';

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
