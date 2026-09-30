import { describe, expect, it } from 'vitest';
import { dependentsOfDeletions, type RowOp } from './change-log';
import { treeRows } from '../testing/rows';

describe('dependentsOfDeletions', () => {
	const rows = () =>
		treeRows({
			people: [{ id: 'sh' }, { id: 'nick' }],
			unions: [{ id: 'u1', partners: ['nick', 'sh'] }],
			names: [{ id: 'm', personId: 'sh', type: 'married', surname: 'Smith', unionId: 'u1' }]
		});

	it('names a name that points at a partnership an undo would delete, so the undo is refused', () => {
		const deleteUnion: RowOp[] = [{ table: 'unions', id: 'u1', before: rows().unions[0]!, after: null }];
		expect(dependentsOfDeletions(rows(), deleteUnion).map((d) => [d.table, (d.row as { id: string }).id])).toContainEqual(['person_names', 'm']);
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
