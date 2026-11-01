import { describe, expect, it } from 'vitest';
import { describeCommand } from './command-summary';
import type { MediaRow, RowOp } from './change-log';
import { invertOps } from './change-log';
import { ConcurrencyConflictError, NotFoundError, ValidationError } from './errors';
import { buildMediaOps } from './media-ops';
import { applyOpsToRows, buildPlanOps } from './tree-ops';
import { TEST_TREE_ID, sequentialIds, treeRows } from '../testing/rows';
import { MAX_MEDIA_TITLE_LENGTH } from '../../shared/media';

const ctx = { treeId: TEST_TREE_ID, now: 2_000_000, newId: sequentialIds('n'), actorId: null };
const mediaCtx = { treeId: TEST_TREE_ID, now: 2_000_000 };

const rows = () =>
	treeRows({
		people: [{ id: 'sh', givenName: 'Jane', surname: 'Doe' }],
		unions: [{ id: 'u1', partners: ['sh'] }],
		media: [
			{ id: 'm1', title: 'Wedding.jpg', linkedTo: ['sh'], version: 2 },
			{ id: 'm2', title: 'Loose.png', version: 1 }
		]
	});

const after = (ops: RowOp[]) => ops[0]?.after as MediaRow | undefined;

describe('renaming a file', () => {
	it('writes the new title, bumps the version and leaves the links alone', () => {
		const ops = buildMediaOps(
			rows(),
			{ kind: 'rename_media', mediaId: 'm1', title: '  Wedding day.jpg ', expectedVersion: 2 },
			mediaCtx
		);
		expect(ops).toHaveLength(1);
		expect(after(ops)).toMatchObject({ title: 'Wedding day.jpg', version: 3 });
	});

	it('writes nothing when the name is unchanged', () => {
		expect(
			buildMediaOps(rows(), { kind: 'rename_media', mediaId: 'm1', title: 'Wedding.jpg' }, mediaCtx)
		).toEqual([]);
	});

	it('refuses an empty name and one longer than the limit', () => {
		const attempt = (title: string) =>
			buildMediaOps(rows(), { kind: 'rename_media', mediaId: 'm1', title }, mediaCtx);
		expect(() => attempt('   ')).toThrow(ValidationError);
		expect(() => attempt('x'.repeat(MAX_MEDIA_TITLE_LENGTH + 1))).toThrow(ValidationError);
	});

	it('refuses a stale version and reports what is current', () => {
		expect(() =>
			buildMediaOps(
				rows(),
				{ kind: 'rename_media', mediaId: 'm1', title: 'New', expectedVersion: 1 },
				mediaCtx
			)
		).toThrow(ConcurrencyConflictError);
	});

	it('names a file that is not in the tree as missing', () => {
		expect(() =>
			buildMediaOps(rows(), { kind: 'rename_media', mediaId: 'nope', title: 'x' }, mediaCtx)
		).toThrow(NotFoundError);
	});
});

const linkOps = (ops: RowOp[]) => ops.filter((op) => op.table === 'media_links');

describe('linking a file', () => {
	it('links a detached file to a person and bumps the file version', () => {
		const ops = buildMediaOps(
			rows(),
			{ kind: 'link_media', mediaId: 'm2', entityId: 'sh' },
			mediaCtx
		);
		expect(after(ops)).toMatchObject({ id: 'm2', version: 2 });
		expect(linkOps(ops)).toEqual([
			{
				table: 'media_links',
				id: 'm2:sh',
				before: null,
				after: expect.objectContaining({ mediaId: 'm2', entityId: 'sh', treeId: TEST_TREE_ID })
			}
		]);
	});

	it('links a file to a union as well as a person', () => {
		const ops = buildMediaOps(
			rows(),
			{ kind: 'link_media', mediaId: 'm2', entityId: 'u1' },
			mediaCtx
		);
		expect(linkOps(ops)[0]?.id).toBe('m2:u1');
	});

	it('adds a second link without touching the first', () => {
		const ops = buildMediaOps(
			rows(),
			{ kind: 'link_media', mediaId: 'm1', entityId: 'u1' },
			mediaCtx
		);
		expect(linkOps(ops).map((op) => op.id)).toEqual(['m1:u1']);
	});

	it('writes nothing when a file is already linked to that record', () => {
		expect(
			buildMediaOps(rows(), { kind: 'link_media', mediaId: 'm1', entityId: 'sh' }, mediaCtx)
		).toEqual([]);
	});

	it('refuses a record that is not in the tree', () => {
		expect(() =>
			buildMediaOps(rows(), { kind: 'link_media', mediaId: 'm2', entityId: 'ghost' }, mediaCtx)
		).toThrow(NotFoundError);
	});

	it('refuses a stale version', () => {
		expect(() =>
			buildMediaOps(
				rows(),
				{ kind: 'link_media', mediaId: 'm1', entityId: 'u1', expectedVersion: 1 },
				mediaCtx
			)
		).toThrow(ConcurrencyConflictError);
	});
});

describe('unlinking a file', () => {
	it('removes the link and keeps the file', () => {
		const ops = buildMediaOps(
			rows(),
			{ kind: 'unlink_media', mediaId: 'm1', entityId: 'sh' },
			mediaCtx
		);
		expect(after(ops)).toMatchObject({ title: 'Wedding.jpg', version: 3 });
		expect(linkOps(ops)).toEqual([
			{ table: 'media_links', id: 'm1:sh', before: expect.anything(), after: null }
		]);
	});

	it('writes nothing for a link that is not there', () => {
		expect(
			buildMediaOps(rows(), { kind: 'unlink_media', mediaId: 'm2', entityId: 'sh' }, mediaCtx)
		).toEqual([]);
	});
});

describe('media commands as planned changes', () => {
	it('plans an unlink through the shared planner and reverses it exactly', () => {
		const before = rows();
		const ops = buildPlanOps(
			before,
			[{ kind: 'unlink_media', mediaId: 'm1', entityId: 'sh' }],
			ctx
		);
		const inverse = invertOps(ops);
		// Applying an op moves its row to the end, so the order is compared by id.
		const byId = <T extends { id: string }>(list: T[]) =>
			[...list].sort((a, b) => a.id.localeCompare(b.id));
		const restored = applyOpsToRows(applyOpsToRows(before, ops), inverse);
		expect(byId(restored.mediaItems)).toEqual(byId(before.mediaItems));
		expect(byId(restored.mediaLinks)).toEqual(byId(before.mediaLinks));
	});

	it('plans a link and undoes it back to no link', () => {
		const before = rows();
		const ops = buildPlanOps(before, [{ kind: 'link_media', mediaId: 'm2', entityId: 'sh' }], ctx);
		expect(applyOpsToRows(before, ops).mediaLinks.map((l) => l.id)).toContain('m2:sh');
		const restored = applyOpsToRows(applyOpsToRows(before, ops), invertOps(ops));
		expect(restored.mediaLinks.map((l) => l.id)).toEqual(['m1:sh']);
	});

	it('deleting one linked person leaves the file on the other', () => {
		const snapshot = treeRows({
			people: [{ id: 'a' }, { id: 'b' }],
			media: [{ id: 'both', linkedTo: ['a', 'b'] }]
		});
		const ops = buildPlanOps(snapshot, [{ kind: 'delete_person', personId: 'a' }], ctx);
		expect(applyOpsToRows(snapshot, ops).mediaLinks.map((l) => l.id)).toEqual(['both:b']);
		expect(applyOpsToRows(snapshot, ops).mediaItems.map((m) => m.id)).toEqual(['both']);
	});

	it('describes a link and an unlink', () => {
		const snapshot = rows();
		expect(describeCommand({ kind: 'link_media', mediaId: 'm2', entityId: 'sh' }, snapshot)).toBe(
			'Linked the file “Loose.png” to Jane Doe'
		);
		expect(describeCommand({ kind: 'unlink_media', mediaId: 'm1', entityId: 'sh' }, snapshot)).toBe(
			'Unlinked the file “Wedding.jpg” from Jane Doe'
		);
	});
});

// ---- Objects, pointers under facts, and the link ops of ADR-082 ----

const objectRows = () =>
	treeRows({
		people: [{ id: 'sh', givenName: 'Jane', surname: 'Doe', birth: '1900' }],
		unions: [{ id: 'u1', partners: ['sh'], marriage: '1925' }],
		events: [{ id: 'ev1', entityId: 'sh', type: 'OCCU' }],
		objects: [{ id: 'o1', version: 4 }],
		media: [
			{ id: 'o1', title: 'Group.jpg', objectId: 'o1', linkedTo: ['sh'] },
			{ id: 'o2', title: 'Second.jpg', objectId: 'o2' }
		]
	});

describe('links under a fact', () => {
	it('links under a fact with an id that names the fact and keeps the owner in entityId', () => {
		const ops = buildMediaOps(
			objectRows(),
			{ kind: 'link_media', mediaId: 'o1', entityId: 'sh', factId: 'ev1' },
			mediaCtx
		);
		const created = linkOps(ops)[0]!;
		expect(created.id).toBe('o1:sh:ev1');
		expect(created.after).toMatchObject({ entityId: 'sh', factId: 'ev1', sortOrder: null });
	});

	it('lets one object sit on a person and on one of their facts', () => {
		const rows = objectRows();
		expect(rows.mediaLinks.map((l) => l.id)).toEqual(['o1:sh']);
		const ops = buildMediaOps(
			rows,
			{ kind: 'link_media', mediaId: 'o1', entityId: 'sh', factId: 'ev1' },
			mediaCtx
		);
		expect(ops.some((op) => op.table === 'media_links')).toBe(true);
	});

	it('refuses a fact that is not the record’s own', () => {
		const rows = objectRows();
		expect(() =>
			buildMediaOps(
				rows,
				{ kind: 'link_media', mediaId: 'o2', entityId: 'u1', factId: 'ev1' },
				mediaCtx
			)
		).toThrow(ValidationError);
		expect(() =>
			buildMediaOps(
				rows,
				{ kind: 'link_media', mediaId: 'o2', entityId: 'sh', factId: 'ghost' },
				mediaCtx
			)
		).toThrow(NotFoundError);
	});

	it('stores sortOrder, crop and title as given, and nulls when they are not', () => {
		const withAll = buildMediaOps(
			objectRows(),
			{
				kind: 'link_media',
				mediaId: 'o2',
				entityId: 'sh',
				sortOrder: 2,
				crop: { top: 1, left: 2, height: 30, width: 40 },
				title: '  Face  '
			},
			mediaCtx
		);
		expect(linkOps(withAll)[0]!.after).toMatchObject({
			sortOrder: 2,
			cropTop: 1,
			cropLeft: 2,
			cropHeight: 30,
			cropWidth: 40,
			title: 'Face'
		});
		const bare = buildMediaOps(
			objectRows(),
			{ kind: 'link_media', mediaId: 'o2', entityId: 'sh' },
			mediaCtx
		);
		expect(linkOps(bare)[0]!.after).toMatchObject({
			sortOrder: null,
			cropTop: null,
			title: null
		});
	});

	it('refuses a crop that is not whole pixels or has no area', () => {
		const attempt = (crop: { top: number; left: number; height: number; width: number }) =>
			buildMediaOps(
				objectRows(),
				{ kind: 'link_media', mediaId: 'o2', entityId: 'sh', crop },
				mediaCtx
			);
		expect(() => attempt({ top: 0.5, left: 0, height: 5, width: 5 })).toThrow(ValidationError);
		expect(() => attempt({ top: 0, left: 0, height: 0, width: 5 })).toThrow(ValidationError);
	});

	it('unlinks only the pointer it names', () => {
		const rows = objectRows();
		rows.mediaLinks.push({ ...rows.mediaLinks[0]!, id: 'o1:sh:ev1', factId: 'ev1' });
		const ops = buildMediaOps(
			rows,
			{ kind: 'unlink_media', mediaId: 'o1', entityId: 'sh', factId: 'ev1' },
			mediaCtx
		);
		expect(linkOps(ops).map((op) => op.id)).toEqual(['o1:sh:ev1']);
	});
});

describe('the version a link op checks and bumps', () => {
	it('checks and bumps the object, leaving the file alone', () => {
		const ops = buildMediaOps(
			objectRows(),
			{ kind: 'link_media', mediaId: 'o1', entityId: 'u1', expectedVersion: 4 },
			mediaCtx
		);
		expect(ops.find((op) => op.table === 'media_object')?.after).toMatchObject({ version: 5 });
		expect(ops.some((op) => op.table === 'media_items')).toBe(false);
		expect(() =>
			buildMediaOps(
				objectRows(),
				{ kind: 'link_media', mediaId: 'o1', entityId: 'u1', expectedVersion: 1 },
				mediaCtx
			)
		).toThrow(ConcurrencyConflictError);
	});

	it('falls back to the file for one not yet backfilled', () => {
		const ops = buildMediaOps(
			rows(),
			{ kind: 'link_media', mediaId: 'm2', entityId: 'sh' },
			mediaCtx
		);
		expect(ops.some((op) => op.table === 'media_items')).toBe(true);
		expect(ops.some((op) => op.table === 'media_object')).toBe(false);
	});
});

describe('editing and reordering links', () => {
	const withTwo = () => {
		const snapshot = objectRows();
		snapshot.mediaLinks.push({
			...snapshot.mediaLinks[0]!,
			id: 'o2:sh',
			mediaId: 'o2',
			sortOrder: null
		});
		return snapshot;
	};

	it('updates only the keys present and clears with null', () => {
		const snapshot = withTwo();
		const edit = buildMediaOps(
			snapshot,
			{
				kind: 'update_media_link',
				mediaId: 'o1',
				entityId: 'sh',
				title: 'A title',
				crop: { top: 0, left: 0, height: 9, width: 9 }
			},
			mediaCtx
		);
		expect(edit.find((op) => op.table === 'media_links')).toMatchObject({
			id: 'o1:sh',
			after: { title: 'A title', cropWidth: 9 }
		});
		const cleared = buildMediaOps(
			applyOpsToRows(snapshot, edit),
			{ kind: 'update_media_link', mediaId: 'o1', entityId: 'sh', title: null },
			mediaCtx
		);
		expect(cleared.find((op) => op.table === 'media_links')?.after).toMatchObject({
			title: null,
			cropWidth: 9
		});
	});

	it('writes nothing for an edit that changes nothing, and refuses a link that is not there', () => {
		expect(
			buildMediaOps(
				objectRows(),
				{ kind: 'update_media_link', mediaId: 'o1', entityId: 'sh', title: null },
				mediaCtx
			)
		).toEqual([]);
		expect(() =>
			buildMediaOps(
				objectRows(),
				{ kind: 'update_media_link', mediaId: 'o2', entityId: 'sh', title: 'x' },
				mediaCtx
			)
		).toThrow(NotFoundError);
	});

	it('writes positions as one change and leaves an unset first link alone', () => {
		const ops = buildMediaOps(
			withTwo(),
			{ kind: 'reorder_media_links', entityId: 'sh', orderedMediaIds: ['o1', 'o2'] },
			mediaCtx
		);
		expect(ops.map((op) => [op.id, (op.after as { sortOrder: number }).sortOrder])).toEqual([
			['o2:sh', 1]
		]);
		const swapped = buildMediaOps(
			withTwo(),
			{ kind: 'reorder_media_links', entityId: 'sh', orderedMediaIds: ['o2', 'o1'] },
			mediaCtx
		);
		expect(swapped.map((op) => op.id)).toEqual(['o1:sh']);
	});

	it('refuses a set that misses or adds a file', () => {
		for (const orderedMediaIds of [['o1'], ['o1', 'o2', 'o3'], ['o1', 'o1']])
			expect(() =>
				buildMediaOps(
					withTwo(),
					{ kind: 'reorder_media_links', entityId: 'sh', orderedMediaIds },
					mediaCtx
				)
			).toThrow(ValidationError);
	});
});

describe('an object’s privacy', () => {
	it('sets it, bumps the object version and checks it', () => {
		const ops = buildMediaOps(
			objectRows(),
			{ kind: 'update_media_object', mediaId: 'o1', privacy: 'private', expectedVersion: 4 },
			mediaCtx
		);
		expect(ops).toEqual([
			{
				table: 'media_object',
				id: 'o1',
				before: expect.objectContaining({ privacy: 'auto' }),
				after: expect.objectContaining({ privacy: 'private', version: 5 })
			}
		]);
		expect(() =>
			buildMediaOps(
				objectRows(),
				{ kind: 'update_media_object', mediaId: 'o1', privacy: 'private', expectedVersion: 2 },
				mediaCtx
			)
		).toThrow(ConcurrencyConflictError);
	});

	it('writes nothing when unchanged and refuses a file with no object row yet', () => {
		expect(
			buildMediaOps(
				objectRows(),
				{ kind: 'update_media_object', mediaId: 'o1', privacy: 'auto' },
				mediaCtx
			)
		).toEqual([]);
		expect(() =>
			buildMediaOps(
				rows(),
				{ kind: 'update_media_object', mediaId: 'm1', privacy: 'private' },
				mediaCtx
			)
		).toThrow(NotFoundError);
	});
});

describe('deleting a fact', () => {
	it('removes its pointers in the same change and undo brings them back', () => {
		const before = objectRows();
		before.mediaLinks.push({ ...before.mediaLinks[0]!, id: 'o1:sh:ev1', factId: 'ev1' });
		const ops = buildPlanOps(before, [{ kind: 'delete_fact', factId: 'ev1' }], ctx);
		const gone = ops.filter((op) => op.table === 'media_links' && op.after === null);
		expect(gone.map((op) => op.id)).toEqual(['o1:sh:ev1']);
		const restored = applyOpsToRows(applyOpsToRows(before, ops), invertOps(ops));
		expect(restored.mediaLinks.map((l) => l.id).sort()).toEqual(['o1:sh', 'o1:sh:ev1']);
	});

	it('leaves the record-level pointer and the object', () => {
		const before = objectRows();
		before.mediaLinks.push({ ...before.mediaLinks[0]!, id: 'o1:sh:ev1', factId: 'ev1' });
		const after = applyOpsToRows(
			before,
			buildPlanOps(before, [{ kind: 'delete_fact', factId: 'ev1' }], ctx)
		);
		expect(after.mediaLinks.map((l) => l.id)).toEqual(['o1:sh']);
		expect(after.mediaObjects.map((o) => o.id)).toEqual(['o1']);
	});
});

describe('describing the new commands', () => {
	it('names the file and the target', () => {
		const snapshot = objectRows();
		expect(
			describeCommand(
				{ kind: 'link_media', mediaId: 'o1', entityId: 'sh', factId: 'ev1' },
				snapshot
			)
		).toBe('Linked the file “Group.jpg” to a fact of Jane Doe');
		expect(
			describeCommand({ kind: 'update_media_object', mediaId: 'o1', privacy: 'private' }, snapshot)
		).toBe('Set the privacy of the file “Group.jpg” to private');
	});
});
