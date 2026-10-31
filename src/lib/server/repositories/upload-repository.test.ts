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
