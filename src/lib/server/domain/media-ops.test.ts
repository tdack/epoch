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
			{ id: 'm1', title: 'Wedding.jpg', entityId: 'sh', version: 2 },
			{ id: 'm2', title: 'Loose.png', entityId: null, version: 1 }
		]
	});

const after = (ops: RowOp[]) => ops[0]?.after as MediaRow | undefined;

describe('renaming a file', () => {
	it('writes the new title, bumps the version and leaves the owner alone', () => {
		const ops = buildMediaOps(
			rows(),
			{ kind: 'rename_media', mediaId: 'm1', title: '  Wedding day.jpg ', expectedVersion: 2 },
			mediaCtx
		);
		expect(ops).toHaveLength(1);
		expect(after(ops)).toMatchObject({ title: 'Wedding day.jpg', entityId: 'sh', version: 3 });
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

describe('attaching and moving a file', () => {
	it('attaches a detached file to a person', () => {
		const ops = buildMediaOps(
			rows(),
			{ kind: 'attach_media', mediaId: 'm2', entityId: 'sh' },
			mediaCtx
		);
		expect(after(ops)).toMatchObject({ entityId: 'sh', version: 2 });
	});

	it('attaches a file to a union as well as a person', () => {
		const ops = buildMediaOps(
			rows(),
			{ kind: 'attach_media', mediaId: 'm2', entityId: 'u1' },
			mediaCtx
		);
		expect(after(ops)?.entityId).toBe('u1');
	});

	it('moves a file from one record to another in the same tree', () => {
		const ops = buildMediaOps(
			rows(),
			{ kind: 'attach_media', mediaId: 'm1', entityId: 'u1' },
			mediaCtx
		);
		expect(after(ops)?.entityId).toBe('u1');
	});

	it('writes nothing when a file is already on that record', () => {
		expect(
			buildMediaOps(rows(), { kind: 'attach_media', mediaId: 'm1', entityId: 'sh' }, mediaCtx)
		).toEqual([]);
	});

	it('refuses a record that is not in the tree', () => {
		expect(() =>
			buildMediaOps(rows(), { kind: 'attach_media', mediaId: 'm2', entityId: 'ghost' }, mediaCtx)
		).toThrow(NotFoundError);
	});
});

describe('detaching a file', () => {
	it('clears the owner and keeps the file', () => {
		const ops = buildMediaOps(rows(), { kind: 'detach_media', mediaId: 'm1' }, mediaCtx);
		expect(after(ops)).toMatchObject({ entityId: null, title: 'Wedding.jpg', version: 3 });
	});

	it('writes nothing for a file that is already detached', () => {
		expect(buildMediaOps(rows(), { kind: 'detach_media', mediaId: 'm2' }, mediaCtx)).toEqual([]);
	});
});

describe('media commands as planned changes', () => {
	it('plans a detach through the shared planner and reverses it exactly', () => {
		const before = rows();
		const ops = buildPlanOps(before, [{ kind: 'detach_media', mediaId: 'm1' }], ctx);
		const inverse = invertOps(ops);
		// Applying an op moves its row to the end, so the order is compared by id.
		const byId = (rows: MediaRow[]) => [...rows].sort((a, b) => a.id.localeCompare(b.id));
		expect(byId(applyOpsToRows(applyOpsToRows(before, ops), inverse).mediaItems)).toEqual(
			byId(before.mediaItems)
		);
	});

	it('describes a move as a move, and an attach as an attach', () => {
		const snapshot = rows();
		expect(describeCommand({ kind: 'attach_media', mediaId: 'm1', entityId: 'u1' }, snapshot)).toBe(
			"Moved the file “Wedding.jpg” to Jane Doe's partnership"
		);
		expect(describeCommand({ kind: 'attach_media', mediaId: 'm2', entityId: 'sh' }, snapshot)).toBe(
			'Attached the file “Loose.png” to Jane Doe'
		);
	});
});
