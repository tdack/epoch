import { describe, expect, it } from 'vitest';
import { describeCommand } from './command-summary';
import type { EventRow, RowOp } from './change-log';
import { ConcurrencyConflictError, NotFoundError, ValidationError } from './errors';
import { buildFactOps } from './fact-ops';
import { treeRows, TEST_TREE_ID } from '../testing/rows';

const ctx = { treeId: TEST_TREE_ID, now: 2_000_000 };
const blank = { dateText: null, place: null, value: null, cause: null, age: null, notes: null };

const wren = () =>
	treeRows({
		people: [{ id: 'wren', givenName: 'Wren', surname: 'Ash' }],
		events: [
			{ id: 'b1', entityId: 'wren', type: 'BIRT', dateRaw: '4 MAR 1900', place: 'Leeds' },
			{ id: 'b2', entityId: 'wren', type: 'BIRT', dateRaw: '5 MAR 1900', place: 'Hull' },
			{ id: 'o1', entityId: 'wren', type: 'OCCU', description: 'Carpenter' }
		]
	});

const after = (ops: RowOp[], id: string) => ops.find((op) => op.id === id)?.after as EventRow | undefined;

describe('facts as row operations', () => {
	it('creates a fact with structured date columns, and leaves the person alone for a non-vital', () => {
		const ops = buildFactOps(wren(), { kind: 'create_fact', personId: 'wren', factId: 'f1', fact: { ...blank, type: 'RESI', dateText: 'ABT 1920', place: '12 High St', notes: 'Rented' } }, ctx);
		expect(ops).toHaveLength(1);
		expect(after(ops, 'f1')).toMatchObject({
			entityType: 'INDIVIDUAL',
			entityId: 'wren',
			type: 'RESI',
			dateRaw: 'ABT 1920',
			dateQualifier: 'ABOUT',
			place: '12 High St',
			notes: 'Rented',
			description: null,
			sortOrder: 0,
			version: 1
		});
	});

	it('bumps the person when a vital is added, changed or removed, so a stale person form conflicts', () => {
		const rows = wren();
		const person = rows.individuals[0]!;
		const created = buildFactOps(rows, { kind: 'create_fact', personId: 'wren', factId: 'd1', fact: { ...blank, type: 'DEAT' } }, ctx);
		expect((created.find((op) => op.table === 'individuals')?.after as { version: number }).version).toBe(person.version + 1);
		expect(buildFactOps(rows, { kind: 'update_fact', factId: 'b1', fact: { place: 'York' } }, ctx).some((op) => op.table === 'individuals')).toBe(true);
		expect(buildFactOps(rows, { kind: 'delete_fact', factId: 'b1' }, ctx).some((op) => op.table === 'individuals')).toBe(true);
		expect(buildFactOps(rows, { kind: 'update_fact', factId: 'o1', fact: { value: 'Joiner' } }, ctx).some((op) => op.table === 'individuals')).toBe(false);
	});

	it('edits one of two conflicting births and writes nothing to the other', () => {
		const ops = buildFactOps(wren(), { kind: 'update_fact', factId: 'b2', fact: { dateText: '6 MAR 1900' } }, ctx);
		expect(ops.filter((op) => op.table === 'events').map((op) => op.id)).toEqual(['b2']);
		expect(after(ops, 'b2')).toMatchObject({ dateRaw: '6 MAR 1900', place: 'Hull', version: 2 });
	});

	it('changes only the fields sent, and clears a field sent as null', () => {
		const ops = buildFactOps(wren(), { kind: 'update_fact', factId: 'b1', fact: { place: null, age: '0' } }, ctx);
		expect(after(ops, 'b1')).toMatchObject({ dateRaw: '4 MAR 1900', place: null, age: '0' });
	});

	it('folds a legacy description into notes when the fact is edited, so export does not write it twice', () => {
		const ops = buildFactOps(wren(), { kind: 'update_fact', factId: 'o1', fact: { value: 'Joiner' } }, ctx);
		expect(after(ops, 'o1')).toMatchObject({ value: 'Joiner', notes: 'Carpenter', description: null });
		const cleared = buildFactOps(wren(), { kind: 'update_fact', factId: 'o1', fact: { notes: null } }, ctx);
		expect(after(cleared, 'o1')).toMatchObject({ notes: null, description: null });
	});

	it('writes nothing for an edit that changes nothing', () => {
		expect(buildFactOps(wren(), { kind: 'update_fact', factId: 'b1', fact: { place: 'Leeds', dateText: '4 MAR 1900' } }, ctx)).toEqual([]);
	});

	it('refuses a stale edit with the stored values, and an unset version skips the check', () => {
		const stale = () => buildFactOps(wren(), { kind: 'update_fact', factId: 'b1', expectedVersion: 0, fact: { place: 'York' } }, ctx);
		expect(stale).toThrow(ConcurrencyConflictError);
		try {
			stale();
		} catch (error) {
			expect((error as ConcurrencyConflictError).details).toMatchObject({ reason: 'STALE_VERSION', entity: 'fact', id: 'b1', current: { place: 'Leeds', dateText: '4 MAR 1900' } });
		}
		expect(buildFactOps(wren(), { kind: 'update_fact', factId: 'b1', expectedVersion: 1, fact: { place: 'York' } }, ctx)).not.toEqual([]);
	});

	it('deletes exactly the fact named', () => {
		const ops = buildFactOps(wren(), { kind: 'delete_fact', factId: 'b2' }, ctx);
		expect(ops.filter((op) => op.table === 'events')).toEqual([expect.objectContaining({ id: 'b2', after: null })]);
	});

	it('refuses types the editor cannot place, union events and facts that are not there', () => {
		const rows = treeRows({
			people: [{ id: 'wren' }],
			unions: [{ id: 'u1', partners: ['wren'], marriage: '1920' }],
			events: [{ id: 'm1', entityType: 'FAMILY', entityId: 'u1', type: 'MARR', dateRaw: '1920' }]
		});
		expect(() => buildFactOps(rows, { kind: 'create_fact', personId: 'wren', factId: 'x', fact: { ...blank, type: 'MARR' } }, ctx)).toThrow(ValidationError);
		expect(() => buildFactOps(rows, { kind: 'create_fact', personId: 'nobody', factId: 'x', fact: { ...blank, type: 'OCCU' } }, ctx)).toThrow(NotFoundError);
		expect(() => buildFactOps(rows, { kind: 'update_fact', factId: 'm1', fact: { place: 'x' } }, ctx)).toThrow(NotFoundError);
		expect(() => buildFactOps(rows, { kind: 'delete_fact', factId: 'nope' }, ctx)).toThrow(NotFoundError);
	});

	it('reorders by renumbering only the facts that move', () => {
		const ops = buildFactOps(wren(), { kind: 'reorder_facts', personId: 'wren', orderedFactIds: ['b2', 'b1', 'o1'] }, ctx);
		expect(ops.map((op) => [op.id, (op.after as EventRow).sortOrder])).toEqual([['b1', 1], ['o1', 2]]);
		expect(() => buildFactOps(wren(), { kind: 'reorder_facts', personId: 'wren', orderedFactIds: ['b1', 'b1'] }, ctx)).toThrow(ValidationError);
	});

	it('describes each command in words', () => {
		const rows = wren();
		expect(describeCommand({ kind: 'create_fact', personId: 'wren', factId: 'x', fact: { ...blank, type: 'OCCU' } }, rows)).toBe('Added occupation to Wren Ash');
		expect(describeCommand({ kind: 'update_fact', factId: 'b1', fact: {} }, rows)).toBe('Edited the birth of Wren Ash');
		expect(describeCommand({ kind: 'delete_fact', factId: 'o1' }, rows)).toBe('Removed the occupation of Wren Ash');
		expect(describeCommand({ kind: 'reorder_facts', personId: 'wren', orderedFactIds: [] }, rows)).toBe('Reordered the facts of Wren Ash');
	});
});
