import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import {
	changeLog,
	changeLogRecords,
	events,
	individuals,
	mediaItems,
	personNames,
	sourceRepositories,
	sources,
	unionPartners,
	unions
} from '../db/schema';
import { ConcurrencyConflictError, ValidationError } from '../domain/errors';
import {
	describeOps,
	invertOps,
	matchesImage,
	rebaseInverse,
	type IndividualRow,
	type RecordTable,
	type RowImage,
	type RowOp,
	type TableRows
} from '../domain/change-log';
import {
	createTestDatabase,
	createTestTree,
	createTestUser,
	type TestActor,
	type TestDatabase
} from '../testing/d1';
import { ChangeStore, toImage } from './change-store';

let t: TestDatabase;
let actor: TestActor;
let treeId: string;
let store: ChangeStore;

beforeAll(async () => {
	t = await createTestDatabase();
	store = new ChangeStore(t.db);
});
afterAll(async () => {
	await t.dispose();
});

async function freshTree() {
	actor = await createTestUser(t.db);
	treeId = await createTestTree(t.db, actor);
}

function person(id: string, givenName: string, version = 1): IndividualRow {
	return {
		xrefAliases: null,
		privacy: 'auto',
		createdBy: null,
		id,
		treeId,
		xrefId: null,
		givenName,
		surname: null,
		sex: null,
		version,
		createdAt: 1_000,
		updatedAt: 1_000
	};
}

/**
 * Fixtures list only the columns a test is about and let the table default the rest, the way an
 * image written before a migration lacks a later column; the cast says so once.
 */
function partialRow<T extends RecordTable>(_table: T, row: object): TableRows[T] {
	return row as unknown as TableRows[T];
}

const base = () => ({
	treeId,
	actorId: actor.userId,
	kind: 'test',
	summary: 'test change',
	changes: [],
	isUndoable: true
});

describe('ChangeStore.commit', () => {
	it('writes the rows, the log entry and its records together', async () => {
		await freshTree();
		const committed = await store.commit({
			...base(),
			ops: [{ table: 'individuals', id: 'a1', before: null, after: person('a1', 'Ada') }]
		});
		expect(committed).not.toBeNull();
		expect(
			(await t.db.select().from(individuals).where(eq(individuals.id, 'a1')).get())?.givenName
		).toBe('Ada');
		const log = await t.db.select().from(changeLog).where(eq(changeLog.id, committed!.id)).get();
		expect(log?.summary).toBe('test change');
		expect(JSON.parse(log!.inverseJson!)).toEqual([
			{ table: 'individuals', id: 'a1', before: person('a1', 'Ada'), after: null }
		]);
		const records = await t.db
			.select()
			.from(changeLogRecords)
			.where(eq(changeLogRecords.changeId, committed!.id))
			.all();
		expect(records).toEqual([{ changeId: committed!.id, entityType: 'person', entityId: 'a1' }]);
	});

	it('writes nothing for ops that change nothing', async () => {
		await freshTree();
		await store.commit({
			...base(),
			ops: [{ table: 'individuals', id: 'b1', before: null, after: person('b1', 'Bea') }]
		});
		const same = person('b1', 'Bea');
		const result = await store.commit({
			...base(),
			ops: [{ table: 'individuals', id: 'b1', before: same, after: { ...same } }]
		});
		expect(result).toBeNull();
		expect((await store.listRecent(treeId, 10)).length).toBe(1);
	});

	it('rejects a stale version and rolls the whole batch back', async () => {
		await freshTree();
		await store.commit({
			...base(),
			ops: [{ table: 'individuals', id: 'c1', before: null, after: person('c1', 'Cy') }]
		});
		const stale: RowOp[] = [
			{ table: 'individuals', id: 'c2', before: null, after: person('c2', 'Dee') },
			{
				table: 'individuals',
				id: 'c1',
				before: person('c1', 'Cy', 7),
				after: person('c1', 'Cyrus', 8)
			}
		];
		await expect(store.commit({ ...base(), ops: stale })).rejects.toMatchObject({
			status: 409,
			details: { reason: 'CONCURRENT_WRITE' }
		});
		await expect(store.commit({ ...base(), ops: stale })).rejects.toBeInstanceOf(
			ConcurrencyConflictError
		);
		expect(
			await t.db.select().from(individuals).where(eq(individuals.id, 'c2')).get()
		).toBeUndefined();
		expect(
			(await t.db.select().from(individuals).where(eq(individuals.id, 'c1')).get())?.givenName
		).toBe('Cy');
		expect((await store.listRecent(treeId, 10)).length).toBe(1);
	});

	it('refuses to delete a row that is already gone', async () => {
		await freshTree();
		await expect(
			store.commit({
				...base(),
				ops: [{ table: 'individuals', id: 'gone', before: person('gone', 'Gil'), after: null }]
			})
		).rejects.toBeInstanceOf(ConcurrencyConflictError);
	});
});

describe('ChangeStore.commit against another editor', () => {
	const link = (id: string, parentId: string, childId: string) =>
		partialRow('parent_child', {
			id,
			treeId,
			parentId,
			childId,
			type: 'biological',
			status: 'active',
			unionId: null,
			gedcomPedi: null,
			version: 1,
			createdAt: 1_000,
			updatedAt: 1_000
		});
	const add = (...ops: RowOp[]) => store.commit({ ...base(), ops });
	const conflict = { status: 409, details: { reason: 'CONCURRENT_WRITE' } };

	async function twoPeople(a: string, b: string) {
		await freshTree();
		await add(
			{ table: 'individuals', id: a, before: null, after: person(a, 'Ann') },
			{ table: 'individuals', id: b, before: null, after: person(b, 'Ben') }
		);
	}

	it('refuses a parent link that, with one just saved, makes someone their own ancestor', async () => {
		await twoPeople('race-r1', 'race-r2');
		await add({
			table: 'parent_child',
			id: 'race-r1>r2',
			before: null,
			after: link('race-r1>r2', 'race-r1', 'race-r2')
		});
		// Planned before the link above existed, so its own cycle check passed.
		await expect(
			add({
				table: 'parent_child',
				id: 'race-r2>r1',
				before: null,
				after: link('race-r2>r1', 'race-r2', 'race-r1')
			})
		).rejects.toMatchObject(conflict);
	});

	it('answers a conflict, not a server error, when both editors add the same link', async () => {
		await twoPeople('race-s1', 'race-s2');
		await add({
			table: 'parent_child',
			id: 'race-s-a',
			before: null,
			after: link('race-s-a', 'race-s1', 'race-s2')
		});
		await expect(
			add({
				table: 'parent_child',
				id: 'race-s-b',
				before: null,
				after: link('race-s-b', 'race-s1', 'race-s2')
			})
		).rejects.toMatchObject(conflict);
	});

	it('refuses to delete a person someone has just linked, rather than drop the link unlogged', async () => {
		await twoPeople('race-d1', 'race-d2');
		await add({
			table: 'parent_child',
			id: 'race-d1>d2',
			before: null,
			after: link('race-d1>d2', 'race-d1', 'race-d2')
		});
		// The delete was planned before the link, so it does not delete it.
		await expect(
			add({ table: 'individuals', id: 'race-d2', before: person('race-d2', 'Ben'), after: null })
		).rejects.toMatchObject(conflict);
		expect(
			await t.db.select().from(individuals).where(eq(individuals.id, 'race-d2')).get()
		).toBeDefined();
	});

	it('still deletes a person whose links the change itself deletes', async () => {
		await twoPeople('race-k1', 'race-k2');
		const kept = link('race-k1>race-k2', 'race-k1', 'race-k2');
		await add({ table: 'parent_child', id: 'race-k1>race-k2', before: null, after: kept });
		await add(
			{ table: 'parent_child', id: 'race-k1>race-k2', before: kept, after: null },
			{ table: 'individuals', id: 'race-k2', before: person('race-k2', 'Ben'), after: null }
		);
		expect(
			await t.db.select().from(individuals).where(eq(individuals.id, 'race-k2')).get()
		).toBeUndefined();
	});

	it('refuses a link to a person someone has just deleted', async () => {
		await twoPeople('race-f1', 'race-f2');
		await add({
			table: 'individuals',
			id: 'race-f2',
			before: person('race-f2', 'Ben'),
			after: null
		});
		await expect(
			add({
				table: 'parent_child',
				id: 'race-f1>f2',
				before: null,
				after: link('race-f1>f2', 'race-f1', 'race-f2')
			})
		).rejects.toMatchObject(conflict);
	});
});

describe('ChangeStore undo lookups', () => {
	it('finds the newest undoable change of the actor and skips changes already undone', async () => {
		await freshTree();
		const other = await createTestUser(t.db, 'other');
		const first = await store.commit({
			...base(),
			ops: [{ table: 'individuals', id: 'd1', before: null, after: person('d1', 'One') }]
		});
		const second = await store.commit({
			...base(),
			ops: [{ table: 'individuals', id: 'd2', before: null, after: person('d2', 'Two') }]
		});
		await store.commit({
			...base(),
			actorId: other.userId,
			ops: [{ table: 'individuals', id: 'd3', before: null, after: person('d3', 'Three') }]
		});
		expect((await store.latestUndoable(treeId, actor.userId))?.id).toBe(second!.id);

		await store.commit({
			...base(),
			kind: 'undo',
			isUndoable: false,
			revertsChangeId: second!.id,
			ops: [{ table: 'individuals', id: 'd2', before: person('d2', 'Two'), after: null }]
		});
		expect((await store.latestUndoable(treeId, actor.userId))?.id).toBe(first!.id);
	});

	it('does not let one change be reverted twice', async () => {
		await freshTree();
		const change = await store.commit({
			...base(),
			ops: [{ table: 'individuals', id: 'e1', before: null, after: person('e1', 'Eve') }]
		});
		await store.commit({
			...base(),
			isUndoable: false,
			revertsChangeId: change!.id,
			ops: [{ table: 'individuals', id: 'e1', before: person('e1', 'Eve'), after: null }]
		});
		await expect(
			store.commit({
				...base(),
				isUndoable: false,
				revertsChangeId: change!.id,
				ops: [{ table: 'individuals', id: 'e9', before: null, after: person('e9', 'Nine') }]
			})
		).rejects.toMatchObject({ details: { reason: 'ALREADY_UNDONE' } });
	});

	it('reports a later change that wrote the same record, but ignores a later change that was itself undone', async () => {
		await freshTree();
		const target = await store.commit({
			...base(),
			ops: [{ table: 'individuals', id: 'f1', before: null, after: person('f1', 'Fay') }]
		});
		const targetSeq = (await store.latestUndoable(treeId, actor.userId))!.seq;

		const later = await store.commit({
			...base(),
			summary: 'renamed Fay',
			ops: [
				{
					table: 'individuals',
					id: 'f1',
					before: person('f1', 'Fay'),
					after: person('f1', 'Fran', 2)
				}
			]
		});
		expect(
			await store.firstTouchedAfter(treeId, targetSeq, [{ entityType: 'person', entityId: 'f1' }])
		).toEqual({
			summary: 'renamed Fay'
		});

		await store.commit({
			...base(),
			kind: 'undo',
			isUndoable: false,
			revertsChangeId: later!.id,
			ops: [
				{
					table: 'individuals',
					id: 'f1',
					before: person('f1', 'Fran', 2),
					after: person('f1', 'Fay', 3)
				}
			]
		});
		expect(
			await store.firstTouchedAfter(treeId, targetSeq, [{ entityType: 'person', entityId: 'f1' }])
		).toBeNull();
		expect(target).not.toBeNull();
	});
});

describe('event row images and the structured date columns', () => {
	const event = (extra: Record<string, unknown> = {}) =>
		partialRow('events', {
			id: 'e1',
			treeId,
			entityType: 'INDIVIDUAL',
			entityId: 'p1',
			type: 'BIRT',
			dateRaw: 'ABT 1900',
			dateSort: '1900-01-01',
			place: null,
			description: null,
			version: 1,
			createdAt: 1_000,
			updatedAt: 1_000,
			...extra
		});

	it('carries the bounds, precision and qualifier in the inverse image, so an undo restores them', async () => {
		await freshTree();
		await store.commit({
			...base(),
			ops: [{ table: 'individuals', id: 'p1', before: null, after: person('p1', 'Pat') }]
		});
		const full = event({
			dateSortEnd: '1900-12-31',
			dateQualifier: 'ABOUT',
			datePrecision: 'YEAR',
			dateCalendar: 'GREGORIAN'
		});
		const committed = await store.commit({
			...base(),
			ops: [{ table: 'events', id: 'e1', before: null, after: full }]
		});
		const stored = await t.db.select().from(events).where(eq(events.id, 'e1')).get();
		expect(stored).toMatchObject({
			dateSortEnd: '1900-12-31',
			dateQualifier: 'ABOUT',
			datePrecision: 'YEAR',
			dateCalendar: 'GREGORIAN'
		});
		const log = await t.db.select().from(changeLog).where(eq(changeLog.id, committed!.id)).get();
		expect(JSON.parse(log!.inverseJson!)[0].before).toMatchObject({
			dateSortEnd: '1900-12-31',
			dateQualifier: 'ABOUT'
		});
	});

	it('reads an image written before the columns existed as nulls, not as an error', async () => {
		await freshTree();
		await store.commit({
			...base(),
			ops: [{ table: 'individuals', id: 'p2', before: null, after: person('p2', 'Pat') }]
		});
		// A log row from before migration 0007 has no date_sort_end, date_qualifier, ...
		await store.commit({
			...base(),
			ops: [{ table: 'events', id: 'e2', before: null, after: event({ id: 'e2', entityId: 'p2' }) }]
		});
		expect(await t.db.select().from(events).where(eq(events.id, 'e2')).get()).toMatchObject({
			dateRaw: 'ABT 1900',
			dateSortEnd: null,
			dateQualifier: null,
			datePrecision: null,
			dateCalendar: null
		});
	});
});

describe('ChangeStore tree scoping', () => {
	it('leaves a row alone when an update or delete names another tree, and still applies the matching tree', async () => {
		await freshTree();
		const otherTree = await createTestTree(t.db, actor);
		await store.commit({
			...base(),
			ops: [{ table: 'individuals', id: 's1', before: null, after: person('s1', 'Sam') }]
		});
		const planned = person('s1', 'Sam');
		const renamed = { ...planned, givenName: 'Sly', version: 2 };
		// Images that claim the other tree, so they pass the single-tree check and only the SQL
		// predicates stand between the commit and a row that lives in a different tree.
		const claimed = { ...planned, treeId: otherTree };

		await expect(
			store.commit({
				...base(),
				treeId: otherTree,
				ops: [
					{ table: 'individuals', id: 's1', before: claimed, after: { ...claimed, version: 2 } }
				]
			})
		).rejects.toMatchObject({ details: { reason: 'CONCURRENT_WRITE' } });
		await expect(
			store.commit({
				...base(),
				treeId: otherTree,
				ops: [{ table: 'individuals', id: 's1', before: claimed, after: null }]
			})
		).rejects.toBeInstanceOf(ConcurrencyConflictError);

		expect(
			(await t.db.select().from(individuals).where(eq(individuals.id, 's1')).get())?.givenName
		).toBe('Sam');
		expect(
			await store.currentImages(
				[{ table: 'individuals', id: 's1', before: planned, after: null }],
				otherTree
			)
		).toEqual(new Map());
		expect((await store.listRecent(treeId, 10)).length).toBe(1);

		await store.commit({
			...base(),
			ops: [{ table: 'individuals', id: 's1', before: planned, after: renamed }]
		});
		expect(
			(await t.db.select().from(individuals).where(eq(individuals.id, 's1')).get())?.givenName
		).toBe('Sly');
	});

	it('refuses an op whose image names a different tree, before writing anything', async () => {
		await freshTree();
		const otherTree = await createTestTree(t.db, actor);
		const stray = { ...person('s2', 'Stray'), treeId: otherTree };

		await expect(
			store.commit({
				...base(),
				ops: [{ table: 'individuals', id: 's2', before: null, after: stray }]
			})
		).rejects.toBeInstanceOf(ValidationError);
		expect(await t.db.select().from(individuals).where(eq(individuals.id, 's2'))).toEqual([]);
		expect((await store.listRecent(treeId, 10)).length).toBe(0);
	});
});

describe('ChangeStore scoping of the child tables that carry a tree_id', () => {
	// Each case seeds a parent in `treeId` and one child row of it, tree_id as the test sets it (the
	// null cast exists only to prove the column refuses it).
	const cases = [
		{
			table: 'person_names' as const,
			schema: personNames,
			seed: async (tree: string, childTree: string | null) => {
				await t.db.insert(individuals).values({ id: 'cp', treeId: tree, version: 1 });
				await t.db
					.insert(personNames)
					.values({ id: 'c1', treeId: childTree as string, personId: 'cp', givenName: 'Ann' });
			},
			edit: (row: RowImage) => ({ ...row, givenName: 'Anna', version: 2 })
		},
		{
			table: 'union_partners' as const,
			schema: unionPartners,
			seed: async (tree: string, childTree: string | null) => {
				await t.db.insert(individuals).values({ id: 'cp', treeId: tree, version: 1 });
				await t.db.insert(unions).values({ id: 'cu', treeId: tree });
				await t.db.insert(unionPartners).values({
					id: 'c1',
					treeId: childTree as string,
					unionId: 'cu',
					personId: 'cp',
					order: 0
				});
			},
			edit: (row: RowImage) => ({ ...row, order: 1 })
		},
		{
			table: 'source_repositories' as const,
			schema: sourceRepositories,
			seed: async (tree: string, childTree: string | null) => {
				await t.db.insert(sources).values({ id: 'cs', treeId: tree, title: 'S', version: 1 });
				await t.db
					.insert(sourceRepositories)
					.values({ id: 'c1', treeId: childTree as string, sourceId: 'cs', callNumber: 'A1' });
			},
			edit: (row: RowImage) => ({ ...row, callNumber: 'A2', version: 2 })
		}
	];

	for (const c of cases) {
		const imageOfChild = async () => {
			const row = await t.db.select().from(c.schema).get();
			return partialRow(c.table, toImage(c.schema, row!));
		};
		const stored = () => t.db.select().from(c.schema).get();
		// `c.table` is a union across the cases, which TypeScript cannot pair with its row type.
		const childOp = (before: RowImage | null, after: RowImage | null) =>
			({ table: c.table, id: 'c1', before, after }) as RowOp;

		it(`${c.table}: refuses an update, delete and undo lookup from another tree`, async () => {
			await t.db.delete(individuals);
			await t.db.delete(unions);
			await t.db.delete(sources);
			await freshTree();
			const otherTree = await createTestTree(t.db, actor);
			await c.seed(treeId, treeId);
			const before = await imageOfChild();
			expect(before).not.toHaveProperty('treeId');

			await expect(
				store.commit({
					...base(),
					treeId: otherTree,
					ops: [childOp(before, partialRow(c.table, c.edit(before)))]
				})
			).rejects.toBeInstanceOf(ConcurrencyConflictError);
			await expect(
				store.commit({
					...base(),
					treeId: otherTree,
					ops: [childOp(before, null)]
				})
			).rejects.toBeInstanceOf(ConcurrencyConflictError);
			expect(await stored()).toBeDefined();
			expect(await store.currentImages([childOp(before, null)], otherTree)).toEqual(new Map());
			expect((await store.currentImages([childOp(before, null)], treeId)).size).toBe(1);
		});

		it(`${c.table}: stamps the commit's tree on insert`, async () => {
			await t.db.delete(individuals);
			await t.db.delete(unions);
			await t.db.delete(sources);
			await freshTree();
			await c.seed(treeId, treeId);
			const image = await imageOfChild();
			await t.db.delete(c.schema);
			await store.commit({
				...base(),
				ops: [childOp(null, image)]
			});
			expect((await stored())?.treeId).toBe(treeId);
		});

		it(`${c.table}: refuses an insert without a tree`, async () => {
			await t.db.delete(individuals);
			await t.db.delete(unions);
			await t.db.delete(sources);
			await freshTree();
			// The store always stamps the commit's tree, so the constraint is checked on the table itself.
			await expect(c.seed(treeId, null)).rejects.toThrow();
			expect(await stored()).toBeUndefined();
		});
	}
});

describe('media row images and the file-manager columns', () => {
	const mediaRow = () =>
		partialRow('media_items', {
			id: 'm1',
			treeId,
			r2ObjectKey: `media/${treeId}/m1.png`,
			cfImageId: null,
			title: 'Portrait',
			mimeType: 'image/png',
			version: 1,
			createdAt: 1_000,
			updatedAt: 1_000
		});
	async function imageOf(id: string) {
		const row = await t.db.select().from(mediaItems).where(eq(mediaItems.id, id)).get();
		return row ? partialRow('media_items', toImage(mediaItems, row)) : null;
	}

	it('leaves sizeBytes and uploadedBy out of the image, so a pre-migration inverse still matches', async () => {
		await freshTree();
		await store.commit({
			...base(),
			ops: [{ table: 'media_items', id: 'm1', before: null, after: mediaRow() }]
		});
		const image = await imageOf('m1');
		expect(image).not.toHaveProperty('sizeBytes');
		expect(image).not.toHaveProperty('uploadedBy');
		// An inverse written before migration 0029 names only the columns that existed then.
		expect(matchesImage(image, { ...image! })).toBe(true);
	});

	it('undoes a rename of a file, using an inverse written before migration 0029', async () => {
		await freshTree();
		await store.commit({
			...base(),
			ops: [
				{
					table: 'media_items',
					id: 'm2',
					before: null,
					after: { ...mediaRow(), id: 'm2', r2ObjectKey: `media/${treeId}/m2.png` }
				}
			]
		});
		const original = (await imageOf('m2'))!;
		// A rename: version 2, one more row touch.
		const beforeMove = (await imageOf('m2'))!;
		await store.commit({
			...base(),
			ops: [
				{
					table: 'media_items',
					id: 'm2',
					before: beforeMove,
					after: { ...beforeMove, title: 'Renamed', version: Number(beforeMove.version) + 1 }
				}
			]
		});
		// The undo's inverse is the original image, as the change stored it.
		const live = (await imageOf('m2'))!;
		const rebased = rebaseInverse(
			[{ table: 'media_items', id: 'm2', before: live, after: original }],
			() => live,
			Date.now()
		);
		expect(rebased.isOk).toBe(true);
		if (!rebased.isOk) return;
		await store.commit({ ...base(), ops: rebased.ops });
		expect((await imageOf('m2'))?.title).toBe('Portrait');
	});
});

describe('fact detail columns and undo of a change logged before them', () => {
	// Migration 0031 added these; an image logged earlier has no key for any of them.
	const FACT_DETAIL_KEYS = [
		'address',
		'addressLayout',
		'classification',
		'agency',
		'phone',
		'email',
		'fax',
		'web',
		'latitude',
		'longitude',
		'placeExtra',
		'religion'
	];
	const withoutFactDetails = (image: RowImage) =>
		partialRow(
			'events',
			Object.fromEntries(Object.entries(image).filter(([key]) => !FACT_DETAIL_KEYS.includes(key)))
		);
	// The database is shared by the tests in this file, so each test names its own rows.
	let sequence = 0;
	let eventId = '';
	let personId = '';
	const eventRow = (extra: Record<string, unknown> = {}) =>
		partialRow('events', {
			id: eventId,
			treeId,
			entityType: 'INDIVIDUAL',
			entityId: personId,
			type: 'BIRT',
			dateRaw: null,
			dateSort: null,
			place: 'Leeds',
			description: null,
			version: 1,
			createdAt: 1_000,
			updatedAt: 1_000,
			...extra
		});
	async function liveImage(id: string) {
		const row = await t.db.select().from(events).where(eq(events.id, id)).get();
		return row ? partialRow('events', toImage(events, row)) : null;
	}
	async function seedEvent() {
		sequence += 1;
		eventId = `fd-event-${sequence}`;
		personId = `fd-person-${sequence}`;
		await freshTree();
		await store.commit({
			...base(),
			ops: [{ table: 'individuals', id: personId, before: null, after: person(personId, 'Pat') }]
		});
		await store.commit({
			...base(),
			ops: [{ table: 'events', id: eventId, before: null, after: eventRow() }]
		});
	}

	it('matches a live row whose new columns are null against an image that lacks them', async () => {
		await seedEvent();
		const live = (await liveImage(eventId))!;
		expect(live).toMatchObject({ address: null, religion: null, placeExtra: null });
		expect(matchesImage(live, withoutFactDetails(live))).toBe(true);
	});

	it('undoes an update logged before the columns existed, with no phantom changed fields', async () => {
		await seedEvent();
		const before = withoutFactDetails((await liveImage(eventId))!);
		const after = { ...before, place: 'Hull', version: Number(before.version) + 1 };
		await store.commit({
			...base(),
			ops: [{ table: 'events', id: eventId, before, after }]
		});
		// The undo is planned from the inverse as the old change stored it, which lacks the columns.
		const inverse = invertOps([{ table: 'events', id: eventId, before, after }]);
		const live = (await liveImage(eventId))!;
		const rebased = rebaseInverse(inverse, (table, id) => (id === eventId ? live : null), 2_000);
		expect(rebased.isOk).toBe(true);
		if (!rebased.isOk) return;
		const described = describeOps(rebased.ops, () => 'event');
		expect(described[0]!.fields.map((field) => field.field)).toEqual(['place']);
		await store.commit({ ...base(), ops: rebased.ops });
		expect((await liveImage(eventId))?.place).toBe('Leeds');
	});

	it('still refuses an undo when a fact detail was set after the change', async () => {
		await seedEvent();
		const before = withoutFactDetails((await liveImage(eventId))!);
		const after = { ...before, place: 'Hull', version: Number(before.version) + 1 };
		await store.commit({ ...base(), ops: [{ table: 'events', id: eventId, before, after }] });
		const inverse = invertOps([{ table: 'events', id: eventId, before, after }]);
		const live = (await liveImage(eventId))!;
		await store.commit({
			...base(),
			ops: [
				{
					table: 'events',
					id: eventId,
					before: live,
					after: { ...live, address: '12 High Street', version: Number(live.version) + 1 }
				}
			]
		});
		const edited = (await liveImage(eventId))!;
		const rebased = rebaseInverse(inverse, (table, id) => (id === eventId ? edited : null), 2_000);
		expect(rebased).toEqual({
			isOk: false,
			mismatch: { table: 'events', id: eventId }
		});
	});
});
