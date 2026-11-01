import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { R2Bucket } from '@cloudflare/workers-types';
import { mediaItems } from '../db/schema';
import { crc32 } from '../gedcom/crc32';
import { installDigestStreamShim } from '../testing/digest-stream';
import {
	createTestDatabase,
	createTestTree,
	createTestUser,
	type TestDatabase
} from '../testing/d1';
import { FakeMediaBucket } from '../testing/fake-bucket';
import { fillMissingChecksums } from './fill-checksums';

const sha256Hex = async (bytes: Uint8Array) =>
	[...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as BufferSource))]
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('');

let t: TestDatabase;
let treeId: string;

beforeAll(async () => {
	installDigestStreamShim();
	t = await createTestDatabase();
	treeId = await createTestTree(t.db, await createTestUser(t.db, 'owner'));
}, 60_000);

afterAll(async () => {
	await t.dispose();
});

async function addRow(
	id: string,
	key: string,
	extra: Partial<typeof mediaItems.$inferInsert> = {}
) {
	await t.db
		.insert(mediaItems)
		.values({ id, treeId, r2ObjectKey: key, mimeType: 'image/png', ...extra });
}

const get = (id: string) => t.db.select().from(mediaItems).where(eq(mediaItems.id, id)).get();

describe('fillMissingChecksums', () => {
	it('fills both checksums once, skips a missing object, and never touches unresolved rows', async () => {
		const bucket = new FakeMediaBucket();
		const bytes = new Uint8Array(70_000).map((_, i) => (i * 13) & 0xff);
		bucket.objects.set('media/a.png', { body: bytes, size: bytes.length });
		await addRow('fill-a', 'media/a.png');
		await addRow('fill-gone', 'media/gone.png');
		await addRow('fill-half', 'media/a.png', { sha256: 'keep', status: 'resolved' });
		await addRow('fill-done', 'media/a.png', { sha256: 'x', crc32: 1 });
		await addRow('fill-unres', 'unresolved/x', { status: 'unresolved' });
		const r2 = bucket as unknown as R2Bucket;

		const first = await fillMissingChecksums(t.db, r2, { limit: 50 });
		expect(first).toEqual({ filled: 2, skipped: 1 });
		expect(await get('fill-a')).toMatchObject({
			sha256: await sha256Hex(bytes),
			crc32: crc32(bytes),
			version: 1
		});
		// A half-filled row is recomputed whole, so both columns agree with the bytes.
		expect((await get('fill-half'))?.sha256).toBe(await sha256Hex(bytes));
		expect(await get('fill-gone')).toMatchObject({ sha256: null, crc32: null });
		expect(await get('fill-done')).toMatchObject({ sha256: 'x', crc32: 1 });
		expect(await get('fill-unres')).toMatchObject({ sha256: null, crc32: null });

		// Idempotent: only the row with no object is left to try.
		expect(await fillMissingChecksums(t.db, r2, { limit: 50 })).toEqual({ filled: 0, skipped: 1 });
	});

	it('leaves an object that does not fit the byte budget', async () => {
		const bucket = new FakeMediaBucket();
		bucket.objects.set('media/big.png', { body: new Uint8Array(100), size: 100 });
		await addRow('big-1', 'media/big.png');
		const r2 = bucket as unknown as R2Bucket;
		// Other tests' missing-object row also counts as skipped, so only `filled` is pinned.
		expect((await fillMissingChecksums(t.db, r2, { limit: 50, maxBytes: 99 })).filled).toBe(0);
		expect((await get('big-1'))?.sha256).toBeNull();
		expect((await fillMissingChecksums(t.db, r2, { limit: 50, maxBytes: 100 })).filled).toBe(1);
	});

	it('reads at most `limit` objects', async () => {
		const bucket = new FakeMediaBucket();
		bucket.objects.set('media/b.png', { body: new Uint8Array([1, 2, 3]), size: 3 });
		for (const id of ['lim-1', 'lim-2', 'lim-3']) await addRow(id, 'media/b.png');
		const result = await fillMissingChecksums(t.db, bucket as unknown as R2Bucket, { limit: 2 });
		expect(result.filled).toBeLessThanOrEqual(2);
	});
});
