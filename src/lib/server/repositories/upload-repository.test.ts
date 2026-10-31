import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
	createTestDatabase,
	createTestTree,
	createTestUser,
	type TestDatabase
} from '../testing/d1';
import { UploadRepository, type NewUploadSession } from './upload-repository';

let t: TestDatabase;
let treeId: string;
let repo: UploadRepository;
const NOW = new Date('2026-01-01T00:00:00Z');
const LATER = new Date('2026-01-02T00:00:00Z');

beforeAll(async () => {
	t = await createTestDatabase();
	const owner = await createTestUser(t.db, 'owner');
	treeId = await createTestTree(t.db, owner);
	repo = new UploadRepository(t.db);
}, 60_000);

afterAll(async () => {
	await t.dispose();
});

function session(overrides: Partial<NewUploadSession> = {}): NewUploadSession {
	const id = crypto.randomUUID();
	return {
		id,
		treeId,
		purpose: 'media',
		r2Key: `staging/uploads/${treeId}/${id}`,
		r2UploadId: 'r2-upload',
		partSizeBytes: 10,
		totalBytes: 25,
		createdBy: null,
		createdAt: NOW,
		expiresAt: LATER,
		...overrides
	};
}

describe('UploadRepository', () => {
	it('round-trips a session with no parts', async () => {
		const row = session();
		await repo.insert(row);
		const found = await repo.find(row.id);
		expect(found).toMatchObject({ id: row.id, status: 'open', parts: {}, totalBytes: 25 });
		expect(await repo.find('missing')).toBeNull();
	});

	it('keeps every etag when parts finish at the same time', async () => {
		const row = session();
		await repo.insert(row);
		await Promise.all(
			Array.from({ length: 20 }, (_, i) => repo.recordPart(row.id, i + 1, `etag-${i + 1}`))
		);
		const parts = (await repo.find(row.id))!.parts;
		expect(Object.keys(parts)).toHaveLength(20);
		expect(parts['7']).toBe('etag-7');
	});

	it('replaces the etag when a part is sent again', async () => {
		const row = session();
		await repo.insert(row);
		await repo.recordPart(row.id, 2, 'first');
		await repo.recordPart(row.id, 2, 'second');
		expect((await repo.find(row.id))!.parts).toEqual({ '2': 'second' });
	});

	it('takes no part once the session is closed, and closes only once', async () => {
		const row = session();
		await repo.insert(row);
		expect(await repo.closeOpen(row.id, 'aborted')).toBe(true);
		expect(await repo.closeOpen(row.id, 'aborted')).toBe(false);
		await repo.recordPart(row.id, 1, 'late');
		expect((await repo.find(row.id))!.parts).toEqual({});
	});

	it('sums only open, unexpired sessions of the tree and purpose', async () => {
		const owner = await createTestUser(t.db, 'other');
		const otherTree = await createTestTree(t.db, owner);
		await repo.insert(session({ treeId: otherTree, totalBytes: 100 }));
		await repo.insert(session({ treeId: otherTree, totalBytes: 50 }));
		await repo.insert(session({ treeId: otherTree, totalBytes: 7, expiresAt: NOW }));
		await repo.insert(session({ treeId: otherTree, totalBytes: 9, purpose: 'gedzip_import' }));
		const closed = session({ treeId: otherTree, totalBytes: 1000 });
		await repo.insert(closed);
		await repo.closeOpen(closed.id, 'aborted');
		expect(await repo.reservedBytes(otherTree, 'media', NOW)).toBe(150);
		expect(await repo.reservedBytes(otherTree, 'media', LATER)).toBe(0);
	});
});

describe('UploadRepository.findExpiredOpen', () => {
	// Earlier than every expiry the rows above use, so their open sessions are not swept here.
	const SWEEP_AT = new Date('2025-06-01T00:00:00Z');
	const OLDER = new Date('2024-12-30T00:00:00Z');
	const NEWER = new Date('2024-12-31T00:00:00Z');

	it('returns open sessions past expiry, oldest first, and no others', async () => {
		const newer = session({ expiresAt: NEWER });
		const older = session({ expiresAt: OLDER });
		const future = session({ expiresAt: LATER });
		const closed = session({ expiresAt: OLDER });
		const completed = session({ expiresAt: OLDER });
		// Inserted newest-first, so only the ORDER BY can put the oldest first.
		for (const row of [newer, older, future, closed, completed]) await repo.insert(row);
		await repo.closeOpen(closed.id, 'aborted');
		await repo.closeOpen(completed.id, 'complete');

		const found = await repo.findExpiredOpen(SWEEP_AT, 10);
		expect(found.map((row) => row.id)).toEqual([older.id, newer.id]);
		expect(found[0]).toEqual({
			id: older.id,
			r2Key: older.r2Key,
			r2UploadId: older.r2UploadId
		});
	});

	it('answers at most the limit', async () => {
		// Earlier than the rows the test above left open, so the one the limit keeps is this one.
		const oldest = session({ expiresAt: new Date('2024-01-01T00:00:00Z') });
		await repo.insert(oldest);
		const found = await repo.findExpiredOpen(SWEEP_AT, 1);
		expect(found.map((row) => row.id)).toEqual([oldest.id]);
	});
});
