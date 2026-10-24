import { describe, expect, it } from 'vitest';
import type { EventRow, IndividualRow, ParentChildRow, PersonNameRow, RowOp } from './change-log';
import {
	ConcurrencyConflictError,
	NotFoundError,
	PersonMergeConflictError,
	ValidationError
} from './errors';
import {
	buildPersonMergeOps,
	personMergeConflicts,
	personMergeRefusal,
	type PersonMergeCommand
} from './person-merge';
import { applyOpsToRows } from './tree-ops';
import { treeRows, sequentialIds, TEST_TREE_ID } from '../testing/rows';
import { MAX_PERSON_MERGE_OPS } from '../../shared/person-merge';

const ctx = () => ({ treeId: TEST_TREE_ID, now: 5_000_000, newId: sequentialIds('new') });
const merge = (
	survivorId: string,
	mergedId: string,
	extra: Partial<PersonMergeCommand> = {}
): PersonMergeCommand => ({ kind: 'merge_people', survivorId, mergedId, ...extra });
const opFor = (ops: RowOp[], table: string, id: string) =>
	ops.find((o) => o.table === table && o.id === id);
const afterOf = <T>(ops: RowOp[], table: string, id: string) =>
	opFor(ops, table, id)?.after as T | null | undefined;

/** Two records of Ann Ash: `a` is older and kept, `b` is the duplicate. */
const twins = () =>
	treeRows({
		people: [
			{ id: 'a', givenName: 'Ann', surname: 'Ash', sex: 'F', birth: '1900' },
			{ id: 'b', givenName: 'Ann', surname: 'Ash', sex: 'F', birth: '1900' }
		],
		names: [
			{ id: 'na', personId: 'a', givenName: 'Ann', surname: 'Ash', isPreferred: true },
			{ id: 'nb', personId: 'b', givenName: 'Ann', surname: 'Ash', isPreferred: true },
			{ id: 'nb2', personId: 'b', type: 'married', givenName: 'Ann', surname: 'Birch' }
		]
	});

describe('what moves and what is kept once', () => {
	it('keeps a name both records have once, moves another as a non-preferred name, and keeps the survivor preferred', () => {
		const ops = buildPersonMergeOps(twins(), merge('a', 'b'), ctx());
		expect(opFor(ops, 'person_names', 'nb')?.after).toBeNull();
		const moved = afterOf<PersonNameRow>(ops, 'person_names', 'nb2')!;
		expect(moved).toMatchObject({ personId: 'a', isPreferred: false, surname: 'Birch' });
		expect(moved.order).toBeGreaterThan(0);
		expect(opFor(ops, 'person_names', 'na')).toBeUndefined();
	});

	it('keeps the other record\'s own name as an "also known as" when no name row carries it', () => {
		const rows = treeRows({
			people: [
				{ id: 'a', givenName: 'Ann', surname: 'Ash' },
				{ id: 'b', givenName: 'Annie', surname: 'Ashe' }
			]
		});
		const ops = buildPersonMergeOps(rows, merge('a', 'b'), ctx());
		const created = ops.filter((o) => o.table === 'person_names' && o.before === null);
		expect(created).toHaveLength(1);
		expect(created[0]!.after).toMatchObject({
			personId: 'a',
			type: 'aka',
			givenName: 'Annie',
			surname: 'Ashe',
			isPreferred: false
		});
		// And nothing is invented when the names agree.
		const same = buildPersonMergeOps(
			treeRows({
				people: [
					{ id: 'a', givenName: 'Ann', surname: 'Ash' },
					{ id: 'b', givenName: 'ann', surname: 'ASH' }
				]
			}),
			merge('a', 'b'),
			ctx()
		);
		expect(same.filter((o) => o.table === 'person_names')).toEqual([]);
	});

	it('keeps two different births, drops a fact stated identically twice, and moves the rest in place', () => {
		const rows = treeRows({
			people: [{ id: 'a' }, { id: 'b' }],
			events: [
				{ id: 'ba', entityId: 'a', type: 'BIRT', dateRaw: '1900', place: 'Leeds' },
				{ id: 'bb', entityId: 'b', type: 'BIRT', dateRaw: '1901', place: 'Hull' },
				{ id: 'ra', entityId: 'a', type: 'RESI', dateRaw: '1920', place: 'York' },
				{ id: 'rb', entityId: 'b', type: 'RESI', dateRaw: '1920', place: 'York' },
				{ id: 'ob', entityId: 'b', type: 'OCCU', description: 'Carpenter' }
			]
		});
		const ops = buildPersonMergeOps(rows, merge('a', 'b'), ctx());
		const after = applyOpsToRows(rows, ops);
		const mine = after.events.filter((e) => e.entityId === 'a');
		expect(mine.map((e) => `${e.type}:${e.dateRaw ?? e.description}`).sort()).toEqual([
			'BIRT:1900',
			'BIRT:1901',
			'OCCU:Carpenter',
			'RESI:1920'
		]);
		expect(opFor(ops, 'events', 'rb')?.after).toBeNull();
		// A non-singular fact keeps its row (and so its place in the order); it only changes owner.
		expect(afterOf<EventRow>(ops, 'events', 'ob')).toMatchObject({ entityId: 'a', version: 2 });
	});

	it('keeps two facts that differ only by an address, and drops one stated identically twice', () => {
		const rows = treeRows({
			people: [{ id: 'a' }, { id: 'b' }],
			events: [
				{
					id: 'ra',
					entityId: 'a',
					type: 'RESI',
					dateRaw: '1920',
					place: 'York',
					address: '1 High St'
				},
				{
					id: 'rb',
					entityId: 'b',
					type: 'RESI',
					dateRaw: '1920',
					place: 'York',
					address: '9 Low Rd'
				},
				{
					id: 'rc',
					entityId: 'b',
					type: 'RESI',
					dateRaw: '1920',
					place: 'York',
					address: '1 High St'
				}
			]
		});
		const after = applyOpsToRows(rows, buildPersonMergeOps(rows, merge('a', 'b'), ctx()));
		expect(
			after.events
				.filter((e) => e.entityId === 'a')
				.map((e) => e.address)
				.sort()
		).toEqual(['1 High St', '9 Low Rd']);
		expect(
			opFor(buildPersonMergeOps(rows, merge('a', 'b'), ctx()), 'events', 'rc')?.after
		).toBeNull();
	});

	it("writes a moved birth after the survivor's own, so the survivor's stays the first birth on file", () => {
		const rows = treeRows({
			people: [{ id: 'a' }, { id: 'b' }],
			events: [
				{ id: 'bb', entityId: 'b', type: 'BIRT', dateRaw: '1901' },
				{ id: 'ba', entityId: 'a', type: 'BIRT', dateRaw: '1900' }
			]
		});
		const after = applyOpsToRows(rows, buildPersonMergeOps(rows, merge('a', 'b'), ctx()));
		const births = after.events.filter((e) => e.entityId === 'a' && e.type === 'BIRT');
		expect(births.map((e) => e.dateRaw)).toEqual(['1900', '1901']);
		expect(births[0]!.id).toBe('ba');
	});

	it('re-points links, dropping one the survivor already asserts and keeping different types of the same pair', () => {
		const rows = treeRows({
			people: [{ id: 'a' }, { id: 'b' }, { id: 'mum' }, { id: 'kid' }, { id: 'both' }],
			links: [
				{ parentId: 'mum', childId: 'a' },
				{ parentId: 'mum', childId: 'b' },
				{ parentId: 'b', childId: 'kid' },
				{ parentId: 'a', childId: 'both' },
				{ parentId: 'b', childId: 'both', type: 'adoptive' },
				{ parentId: 'b', childId: 'both' }
			]
		});
		const ops = buildPersonMergeOps(rows, merge('a', 'b'), ctx());
		const after = applyOpsToRows(rows, ops);
		const pairs = after.parentChild
			.map((l: ParentChildRow) => `${l.parentId}>${l.childId}>${l.type}`)
			.sort();
		expect(pairs).toEqual([
			'a>both>adoptive',
			'a>both>biological',
			'a>kid>biological',
			'mum>a>biological'
		]);
		expect(after.parentChild.some((l) => l.parentId === 'b' || l.childId === 'b')).toBe(false);
	});

	it('re-points partnerships, bumps each partnership that changed and no other', () => {
		const rows = treeRows({
			people: [{ id: 'a' }, { id: 'b' }, { id: 'p1' }, { id: 'p2' }],
			unions: [
				{ id: 'u1', partners: ['b', 'p1'] },
				{ id: 'u2', partners: ['a', 'p2'] }
			]
		});
		const ops = buildPersonMergeOps(rows, merge('a', 'b'), ctx());
		const after = applyOpsToRows(rows, ops);
		expect(
			after.unionPartners
				.filter((p) => p.unionId === 'u1')
				.map((p) => p.personId)
				.sort()
		).toEqual(['a', 'p1']);
		expect(afterOf<{ version: number }>(ops, 'unions', 'u1')!.version).toBe(2);
		expect(opFor(ops, 'unions', 'u2')).toBeUndefined();
	});

	it('moves media, and records the gone XREF (and the ones it had absorbed) as aliases of the survivor', () => {
		const rows = treeRows({ people: [{ id: 'a' }, { id: 'b' }] });
		rows.individuals[1] = { ...rows.individuals[1]!, xrefAliases: ['@OLD@'] };
		rows.mediaLinks.push({
			id: 'm1:b',
			treeId: TEST_TREE_ID,
			mediaId: 'm1',
			entityId: 'b',
			createdAt: 1
		});
		rows.mediaItems.push({
			id: 'm1',
			treeId: TEST_TREE_ID,
			entityId: null,
			r2ObjectKey: 'k',
			cfImageId: null,
			title: null,
			mimeType: 'image/png',
			version: 1,
			createdAt: 1,
			updatedAt: 1
		} as never);
		const ops = buildPersonMergeOps(rows, merge('a', 'b'), ctx());
		expect(opFor(ops, 'media_links', 'm1:b')?.after).toBeNull();
		expect(afterOf<{ entityId: string }>(ops, 'media_links', 'm1:a')!.entityId).toBe('a');
		expect(afterOf<IndividualRow>(ops, 'individuals', 'a')!.xrefAliases).toEqual(['@b@', '@OLD@']);
		expect(opFor(ops, 'individuals', 'b')?.after).toBeNull();
	});
});

describe('what the user must decide, and what is only ever tightened', () => {
	it('asks which sex to keep when both are recorded and differ, and fills a blank from the other', () => {
		const rows = treeRows({
			people: [
				{ id: 'a', sex: 'F' },
				{ id: 'b', sex: 'M' },
				{ id: 'c', sex: 'U' }
			]
		});
		expect(personMergeConflicts(rows, 'a', 'b')).toEqual([
			{ kind: 'sex', survivor: 'F', merged: 'M' }
		]);
		expect(() => buildPersonMergeOps(rows, merge('a', 'b'), ctx())).toThrow(
			PersonMergeConflictError
		);
		expect(
			afterOf<IndividualRow>(
				buildPersonMergeOps(rows, merge('a', 'b', { keep: { sex: 'merged' } }), ctx()),
				'individuals',
				'a'
			)!.sex
		).toBe('M');
		expect(
			afterOf<IndividualRow>(
				buildPersonMergeOps(rows, merge('a', 'b', { keep: { sex: 'survivor' } }), ctx()),
				'individuals',
				'a'
			)!.sex
		).toBe('F');
		expect(personMergeConflicts(rows, 'a', 'c')).toEqual([]);
		expect(
			afterOf<IndividualRow>(buildPersonMergeOps(rows, merge('c', 'a'), ctx()), 'individuals', 'c')!
				.sex
		).toBe('F');
	});

	it('never makes anyone less private', () => {
		const rows = treeRows({ people: [{ id: 'a' }, { id: 'b' }] });
		rows.individuals[1] = { ...rows.individuals[1]!, privacy: 'private' };
		expect(
			afterOf<IndividualRow>(buildPersonMergeOps(rows, merge('a', 'b'), ctx()), 'individuals', 'a')!
				.privacy
		).toBe('private');
		rows.individuals[0] = { ...rows.individuals[0]!, privacy: 'private' };
		rows.individuals[1] = { ...rows.individuals[1]!, privacy: 'public' };
		expect(
			afterOf<IndividualRow>(buildPersonMergeOps(rows, merge('a', 'b'), ctx()), 'individuals', 'a')!
				.privacy
		).toBe('private');
	});
});

describe('who cannot be one person', () => {
	it('refuses the same person, an ancestor and a descendant (however far), and the two partners of one partnership', () => {
		const rows = treeRows({
			people: [{ id: 'gran' }, { id: 'mum' }, { id: 'me' }, { id: 'pa' }, { id: 'ma' }],
			links: [
				{ parentId: 'gran', childId: 'mum' },
				{ parentId: 'mum', childId: 'me' }
			],
			unions: [{ id: 'u', partners: ['pa', 'ma'] }]
		});
		expect(personMergeRefusal(rows, 'me', 'me')).toMatch(/different people/);
		expect(personMergeRefusal(rows, 'me', 'mum')).toMatch(/ancestor/);
		expect(personMergeRefusal(rows, 'gran', 'me')).toMatch(/ancestor/);
		expect(personMergeRefusal(rows, 'pa', 'ma')).toMatch(/partners/);
		expect(() => buildPersonMergeOps(rows, merge('me', 'gran'), ctx())).toThrow(ValidationError);
	});

	it('allows siblings: the commonest duplicate is one child entered twice under the same parents', () => {
		const rows = treeRows({
			people: [
				{ id: 'mum' },
				{ id: 'dad' },
				{ id: 'a', givenName: 'Kit' },
				{ id: 'b', givenName: 'Kit' }
			],
			links: [
				{ parentId: 'mum', childId: 'a' },
				{ parentId: 'dad', childId: 'a' },
				{ parentId: 'mum', childId: 'b' },
				{ parentId: 'dad', childId: 'b' }
			]
		});
		expect(personMergeRefusal(rows, 'a', 'b')).toBeNull();
		const after = applyOpsToRows(rows, buildPersonMergeOps(rows, merge('a', 'b'), ctx()));
		expect(after.parentChild.map((l) => `${l.parentId}>${l.childId}`).sort()).toEqual([
			'dad>a',
			'mum>a'
		]);
	});

	it('names a missing person, and a stale version', () => {
		const rows = twins();
		expect(() => buildPersonMergeOps(rows, merge('a', 'nobody'), ctx())).toThrow(NotFoundError);
		expect(() =>
			buildPersonMergeOps(rows, merge('a', 'b', { expectedVersions: { b: 9 } }), ctx())
		).toThrow(ConcurrencyConflictError);
		expect(() =>
			buildPersonMergeOps(rows, merge('a', 'b', { expectedVersions: { a: 1, b: 1 } }), ctx())
		).not.toThrow();
	});

	it('links a file on both people once, to the survivor', () => {
		const rows = treeRows({
			people: [{ id: 'a' }, { id: 'b' }],
			media: [
				{ id: 'both', linkedTo: ['a', 'b'] },
				{ id: 'only-b', linkedTo: ['b'] }
			]
		});
		const ops = buildPersonMergeOps(rows, merge('a', 'b'), ctx());
		const after = applyOpsToRows(rows, ops)
			.mediaLinks.map((l) => l.id)
			.sort();
		expect(after).toEqual(['both:a', 'only-b:a']);
	});

	it('counts a moved file toward the same limit as every other record in the merge', () => {
		const rowsWith = (count: number) =>
			treeRows({
				people: [{ id: 'a' }, { id: 'b' }],
				media: Array.from({ length: count }, (_, i) => ({ id: `m${i}`, linkedTo: ['b'] }))
			});
		const baseline = buildPersonMergeOps(rowsWith(0), merge('a', 'b'), ctx()).length;
		// A moved file is two ops: its old link goes and the survivor's comes.
		const room = Math.floor((MAX_PERSON_MERGE_OPS - baseline) / 2);
		expect(buildPersonMergeOps(rowsWith(room), merge('a', 'b'), ctx()).length).toBeGreaterThan(
			MAX_PERSON_MERGE_OPS - 2
		);
		expect(() => buildPersonMergeOps(rowsWith(room + 1), merge('a', 'b'), ctx())).toThrow(
			/at most/
		);
	});

	it('refuses a person with more records than one change can carry', () => {
		const events = Array.from({ length: MAX_PERSON_MERGE_OPS + 1 }, (_, i) => ({
			id: `e${i}`,
			entityId: 'b',
			type: 'RESI',
			dateRaw: String(1000 + i)
		}));
		expect(() =>
			buildPersonMergeOps(
				treeRows({ people: [{ id: 'a' }, { id: 'b' }], events }),
				merge('a', 'b'),
				ctx()
			)
		).toThrow(/at most/);
	});
});

describe('the result', () => {
	it('leaves nothing that points at the merged person, and writes every row at most once', () => {
		const rows = treeRows({
			people: [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }],
			links: [
				{ parentId: 'b', childId: 'c' },
				{ parentId: 'd', childId: 'b' }
			],
			unions: [{ id: 'u', partners: ['b', 'c'] }],
			events: [{ id: 'e', entityId: 'b', type: 'OCCU', description: 'x' }],
			names: [{ id: 'n', personId: 'b', givenName: 'Bee' }]
		});
		const ops = buildPersonMergeOps(rows, merge('a', 'b'), ctx());
		expect(new Set(ops.map((o) => `${o.table}:${o.id}`)).size).toBe(ops.length);
		const after = applyOpsToRows(rows, ops);
		expect(after.individuals.map((p) => p.id).sort()).toEqual(['a', 'c', 'd']);
		const pointers = [
			...after.parentChild.flatMap((l) => [l.parentId, l.childId]),
			...after.unionPartners.map((p) => p.personId),
			...after.events.map((e) => e.entityId),
			...after.personNames.map((n) => n.personId)
		];
		expect(pointers).not.toContain('b');
	});
});
