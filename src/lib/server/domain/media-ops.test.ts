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
