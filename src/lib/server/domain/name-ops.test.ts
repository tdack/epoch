import { describe, expect, it } from 'vitest';
import { describeCommand } from './command-summary';
import type { IndividualRow, PersonNameRow, RowOp } from './change-log';
import { ConcurrencyConflictError, NotFoundError, ValidationError } from './errors';
import { buildNameOps } from './name-ops';
import { applyOpsToRows, buildPlanOps } from './tree-ops';
import { treeRows, sequentialIds, TEST_TREE_ID } from '../testing/rows';
import { displayNameWith, splitDisplayName } from '../../shared/name-types';

const ctx = { treeId: TEST_TREE_ID, now: 2_000_000, newId: sequentialIds('n'), actorId: null };

const jessica = () =>
	treeRows({
		people: [
			{ id: 'sh', givenName: 'Jessica', surname: 'Simpson', version: 3 },
			{ id: 'nick', givenName: 'Nick', surname: 'Smith' }
		],
		unions: [{ id: 'u1', partners: ['nick', 'sh'], marriage: '1998' }],
		names: [
			{
				id: 'n-birth',
				personId: 'sh',
				type: 'birth',
				givenName: 'Jessica',
				surname: 'Simpson',
				isPreferred: true
			}
		]
	});

const person = (ops: RowOp[], id = 'sh') =>
	ops.find((op) => op.table === 'individuals' && op.id === id)?.after as IndividualRow | undefined;
const name = (ops: RowOp[], id: string) =>
	ops.find((op) => op.table === 'person_names' && op.id === id)?.after as PersonNameRow | undefined;

describe('names as row operations', () => {
	it('adds a married name that is not preferred, leaving the display name alone', () => {
		const ops = buildNameOps(
			jessica(),
			{
				kind: 'create_name',
				personId: 'sh',
				nameId: 'n-m',
				name: { type: 'married', givenName: 'Jessica', surname: 'Smith' }
			},
			ctx
		);
		expect(name(ops, 'n-m')).toMatchObject({
			type: 'married',
			surname: 'Smith',
			isPreferred: false,
			order: 1,
			version: 1
		});
		expect(ops.some((op) => op.table === 'individuals')).toBe(false);
	});

	it('makes a new preferred name the display name in the same change, and demotes the old one', () => {
		const ops = buildNameOps(
			jessica(),
			{
				kind: 'create_name',
				personId: 'sh',
				nameId: 'n-m',
				isPreferred: true,
				name: { type: 'married', givenName: 'Jessica', surname: 'Smith' }
			},
			ctx
		);
		expect(person(ops)).toMatchObject({ surname: 'Smith', version: 4 });
		expect(name(ops, 'n-birth')).toMatchObject({ isPreferred: false, version: 2 });
		const next = applyOpsToRows(jessica(), ops);
		expect(next.personNames.filter((n) => n.isPreferred)).toHaveLength(1);
	});

	it('editing the preferred name updates the display name; editing another does not', () => {
		const rows = treeRows({
			people: [{ id: 'sh', givenName: 'Jessica', surname: 'Simpson' }],
			names: [
				{ id: 'a', personId: 'sh', givenName: 'Jessica', surname: 'Simpson', isPreferred: true },
				{ id: 'b', personId: 'sh', type: 'married', givenName: 'Jessica', surname: 'Smith' }
			]
		});
		expect(
			person(
				buildNameOps(
					rows,
					{ kind: 'update_name', nameId: 'a', name: { surname: 'Simpson-Smith' } },
					ctx
				)
			)?.surname
		).toBe('Simpson-Smith');
		expect(
			buildNameOps(
				rows,
				{ kind: 'update_name', nameId: 'b', name: { surname: 'Kenny' } },
				ctx
			).some((op) => op.table === 'individuals')
		).toBe(false);
	});

	it('writes no ops for an edit that changes nothing', () => {
		expect(
			buildNameOps(
				jessica(),
				{
					kind: 'update_name',
					nameId: 'n-birth',
					name: { givenName: 'Jessica ', surname: 'Simpson' }
				},
				ctx
			)
		).toEqual([]);
	});

	it('stores the from-date in the date columns and rejects a partnership the person is not in', () => {
		const rows = jessica();
		const ops = buildNameOps(
			rows,
			{
				kind: 'create_name',
				personId: 'sh',
				nameId: 'n-m',
				name: { type: 'married', surname: 'Smith', dateText: 'ABT 1998', unionId: 'u1' }
			},
			ctx
		);
		expect(name(ops, 'n-m')).toMatchObject({
			dateRaw: 'ABT 1998',
			dateQualifier: 'ABOUT',
			unionId: 'u1'
		});
		const other = treeRows({
			people: [{ id: 'sh' }, { id: 'x' }],
			unions: [{ id: 'u9', partners: ['x'] }],
			names: []
		});
		expect(() =>
			buildNameOps(
				other,
				{
					kind: 'create_name',
					personId: 'sh',
					nameId: 'n',
					name: { type: 'married', surname: 'K', unionId: 'u9' }
				},
				ctx
			)
		).toThrow(ValidationError);
	});

	it('deleting the preferred name promotes the next and re-syncs the display name; the only name cannot go', () => {
		const rows = treeRows({
			people: [{ id: 'sh', givenName: 'Jessica', surname: 'Smith' }],
			names: [
				{
					id: 'a',
					personId: 'sh',
					type: 'married',
					givenName: 'Jessica',
					surname: 'Smith',
					isPreferred: true
				},
				{ id: 'b', personId: 'sh', givenName: 'Jessica', surname: 'Simpson' }
			]
		});
		const ops = buildNameOps(rows, { kind: 'delete_name', nameId: 'a' }, ctx);
		expect(name(ops, 'b')).toMatchObject({ isPreferred: true });
		expect(person(ops)?.surname).toBe('Simpson');
		expect(() => buildNameOps(jessica(), { kind: 'delete_name', nameId: 'n-birth' }, ctx)).toThrow(
			ValidationError
		);
	});

	it('set_preferred_name switches which name is preferred and the display name with it', () => {
		const rows = treeRows({
			people: [{ id: 'sh', givenName: 'Jessica', surname: 'Simpson' }],
			names: [
				{ id: 'a', personId: 'sh', givenName: 'Jessica', surname: 'Simpson', isPreferred: true },
				{ id: 'b', personId: 'sh', type: 'married', givenName: 'Jessica', surname: 'Smith' }
			]
		});
		const ops = buildNameOps(
			rows,
			{ kind: 'set_preferred_name', personId: 'sh', nameId: 'b' },
			ctx
		);
		expect(person(ops)?.surname).toBe('Smith');
		expect(name(ops, 'a')?.isPreferred).toBe(false);
		expect(
			buildNameOps(rows, { kind: 'set_preferred_name', personId: 'sh', nameId: 'a' }, ctx)
		).toEqual([]);
	});

	it('reorders, refusing a partial or foreign list', () => {
		const rows = treeRows({
			people: [{ id: 'sh' }],
			names: [
				{ id: 'a', personId: 'sh', isPreferred: true, givenName: 'A' },
				{ id: 'b', personId: 'sh', givenName: 'B' }
			]
		});
		const ops = buildNameOps(
			rows,
			{ kind: 'reorder_names', personId: 'sh', orderedNameIds: ['b', 'a'] },
			ctx
		);
		expect(name(ops, 'b')?.order).toBe(0);
		expect(name(ops, 'a')?.order).toBe(1);
		expect(() =>
			buildNameOps(rows, { kind: 'reorder_names', personId: 'sh', orderedNameIds: ['b'] }, ctx)
		).toThrow(ValidationError);
	});

	it('gives a person with no name row one that matches their fields, then adds the new name', () => {
		const rows = treeRows({ people: [{ id: 'sh', givenName: 'Jessica', surname: 'Simpson' }] });
		const ops = buildNameOps(
			rows,
			{
				kind: 'create_name',
				personId: 'sh',
				nameId: 'n-m',
				name: { type: 'married', surname: 'Smith' }
			},
			ctx
		);
		const created = ops
			.filter((op) => op.table === 'person_names' && op.before === null)
			.map((op) => op.after as PersonNameRow);
		expect(created).toHaveLength(2);
		expect(created.find((n) => n.isPreferred)).toMatchObject({
			givenName: 'Jessica',
			surname: 'Simpson'
		});
	});

	it('a stale version is a conflict that carries the stored name; unknown names are not found', () => {
		const rows = jessica();
		expect(() =>
			buildNameOps(
				rows,
				{ kind: 'update_name', nameId: 'n-birth', expectedVersion: 9, name: { surname: 'X' } },
				ctx
			)
		).toThrow(ConcurrencyConflictError);
		expect(() => buildNameOps(rows, { kind: 'delete_name', nameId: 'nope' }, ctx)).toThrow(
			NotFoundError
		);
	});

	it('describes each command', () => {
		const rows = jessica();
		expect(
			describeCommand(
				{
					kind: 'create_name',
					personId: 'sh',
					nameId: 'x',
					name: { type: 'married', givenName: 'Jessica', surname: 'Smith' }
				},
				rows
			)
		).toBe('Added married name Jessica Wren to Jessica Lovejoy');
		expect(describeCommand({ kind: 'delete_name', nameId: 'n-birth' }, rows)).toBe(
			'Removed the birth name of Jessica Lovejoy'
		);
	});
});

describe('names and the person form', () => {
	it('update_person edits the preferred name row with the person, in the same plan', () => {
		const rows = jessica();
		const ops = buildPlanOps(
			rows,
			[{ kind: 'update_person', personId: 'sh', surname: 'Simpson-Smith' }],
			ctx
		);
		expect(name(ops, 'n-birth')).toMatchObject({ surname: 'Simpson-Smith', version: 2 });
		expect(person(ops)?.surname).toBe('Simpson-Smith');
	});

	it('create_person gives the person a preferred name row', () => {
		const ops = buildPlanOps(
			treeRows(),
			[{ kind: 'create_person', personId: 'p', givenName: 'Ann', surname: 'Ash', sex: 'F' }],
			ctx
		);
		const row = ops.find((op) => op.table === 'person_names')?.after as PersonNameRow;
		expect(row).toMatchObject({
			personId: 'p',
			givenName: 'Ann',
			surname: 'Ash',
			isPreferred: true
		});
	});
});

describe('names that came from a partnership', () => {
	const married = () =>
		treeRows({
			people: [{ id: 'sh', givenName: 'Jessica', surname: 'Smith' }, { id: 'nick' }],
			unions: [
				{ id: 'u1', partners: ['nick', 'sh'] },
				{ id: 'u2', partners: ['nick', 'sh'] }
			],
			names: [
				{
					id: 'a',
					personId: 'sh',
					type: 'married',
					surname: 'Smith',
					isPreferred: true,
					unionId: 'u1'
				}
			]
		});

	it('deleting the partnership unlinks the name in the same change, so undo can restore it', () => {
		const ops = buildPlanOps(married(), [{ kind: 'destroy_union', unionId: 'u1' }], ctx);
		expect(name(ops, 'a')).toMatchObject({ unionId: null });
	});

	it('merging partnerships points the name at the survivor', () => {
		const ops = buildPlanOps(
			married(),
			[{ kind: 'merge_unions', survivorId: 'u2', mergedIds: ['u1'] }],
			ctx
		);
		expect(name(ops, 'a')).toMatchObject({ unionId: 'u2' });
	});

	it('removing the person from the partnership unlinks their names', () => {
		const ops = buildPlanOps(
			married(),
			[{ kind: 'remove_partner_from_union', unionId: 'u1', personId: 'sh' }],
			ctx
		);
		expect(name(ops, 'a')).toMatchObject({ unionId: null });
	});
});

describe('the display formatter', () => {
	const names = [
		{ type: 'birth', surname: 'Simpson', isPreferred: false },
		{ type: 'married', surname: 'Smith', isPreferred: true }
	];
	it('adds the birth surname when it differs from the preferred one', () => {
		expect(displayNameWith({ givenName: 'Jessica', surname: 'Smith' }, names)).toBe(
			'Jessica Wren (née Lovejoy)'
		);
	});
	it('adds nothing when it is the same, when the birth name is the preferred one, or when there are no names', () => {
		expect(
			displayNameWith(
				{ givenName: 'Jessica', surname: 'Simpson' },
				names.slice(0, 1).map((n) => ({ ...n, isPreferred: true }))
			)
		).toBe('Jessica Lovejoy');
		expect(displayNameWith({ givenName: 'Jessica', surname: 'simpson' }, names)).toBe(
			'Jessica little'
		);
		expect(displayNameWith({ givenName: 'Jessica', surname: 'Smith' })).toBe('Jessica Wren');
		expect(displayNameWith(undefined)).toBe('Unknown');
	});
	it('splits a display name back into the name and the birth surname', () => {
		expect(splitDisplayName('Jessica Wren (née Lovejoy)')).toEqual({
			name: 'Jessica Wren',
			birthSurname: 'Simpson'
		});
		expect(splitDisplayName('Jessica Lovejoy')).toEqual({
			name: 'Jessica Lovejoy',
			birthSurname: null
		});
		expect(
			splitDisplayName(
				displayNameWith({ givenName: 'A', surname: 'C' }, [{ type: 'maiden', surname: 'De la M' }])
			)
		).toEqual({ name: 'A C', birthSurname: 'De la M' });
	});
	it('prefers a maiden name over a birth name', () => {
		expect(
			displayNameWith({ givenName: 'A', surname: 'C' }, [
				{ type: 'birth', surname: 'B' },
				{ type: 'maiden', surname: 'M' }
			])
		).toBe('A C (née M)');
	});
});
