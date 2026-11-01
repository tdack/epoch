import { describe, expect, it } from 'vitest';
import { describeCommand } from './command-summary';
import type { MediaRow, RowOp } from './change-log';
import { invertOps } from './change-log';
import { ConcurrencyConflictError, NotFoundError, ValidationError } from './errors';
import { buildMediaOps } from './media-ops';
import { applyOpsToRows } from './tree-ops';
import { TEST_TREE_ID, treeRows } from '../testing/rows';

const mediaCtx = { treeId: TEST_TREE_ID, now: 2_000_000 };
const after = (ops: RowOp[]) => ops[0]?.after as MediaRow | undefined;

const pending = () =>
	treeRows({
		media: [
			{
				id: 'u1',
				title: 'Scan',
				status: 'unresolved',
				r2ObjectKey: 'unresolved/u1',
				gedcomPath: 'a/scan.png',
				version: 4
			},
			{ id: 'm1', title: 'Stored.jpg', version: 1 }
		]
	});

const resolve = (rows: ReturnType<typeof pending>, extra = {}) =>
	buildMediaOps(
		rows,
		{
			kind: 'resolve_media_file',
			fileId: 'u1',
			objectKey: 'media/tree-1/u1.png',
			mimeType: 'image/png',
			...extra
		},
		mediaCtx
	);

describe('resolving an unresolved file', () => {
	it('sets the key, type and status, keeps the path, and inverts to the unresolved row', () => {
		const rows = pending();
		const ops = resolve(rows, { expectedVersion: 4 });
		expect(after(ops)).toMatchObject({
			r2ObjectKey: 'media/tree-1/u1.png',
			mimeType: 'image/png',
			status: null,
			gedcomPath: 'a/scan.png',
			version: 5
		});
		const restored = applyOpsToRows(applyOpsToRows(rows, ops), invertOps(ops));
		expect(restored.mediaItems.find((m) => m.id === 'u1')).toMatchObject({
			status: 'unresolved',
			r2ObjectKey: 'unresolved/u1'
		});
	});

	it('refuses a stale version, a resolved file, a type Epoch does not store and a missing file', () => {
		expect(() => resolve(pending(), { expectedVersion: 1 })).toThrow(ConcurrencyConflictError);
		expect(() => resolve(pending(), { fileId: 'm1' })).toThrow(ValidationError);
		expect(() => resolve(pending(), { mimeType: 'image/svg+xml' })).toThrow(ValidationError);
		expect(() => resolve(pending(), { fileId: 'nope' })).toThrow(NotFoundError);
	});

	it('is described by the file it fills', () => {
		expect(
			describeCommand(
				{ kind: 'resolve_media_file', fileId: 'u1', objectKey: 'k', mimeType: 'image/png' },
				pending()
			)
		).toBe('Added the file for “Scan”');
	});
});
