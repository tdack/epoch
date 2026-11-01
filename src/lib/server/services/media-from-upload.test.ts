/**
 * Turning a finished upload session into a file: the bytes decide the type, only the session's
 * creator may do it, and one upload can become one file.
 */

import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { R2Bucket } from '@cloudflare/workers-types';
import { individuals, mediaItems } from '../db/schema';
import { NotFoundError, PayloadTooLargeError, ValidationError } from '../domain/errors';
import {
	addTestMember,
	createTestDatabase,
	createTestTree,
	createTestUser,
	type TestActor,
	type TestDatabase
} from '../testing/d1';
import { FakeMultipartBucket } from '../testing/fake-multipart-bucket';
import { crc32 } from '../gedcom/crc32';
import { crc32Tap } from '../http/crc32-tap';
import { MAX_TREE_MEDIA_BYTES } from '../../shared/media';
import { MediaService } from './media-service';
import { UploadService } from './upload-service';

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x49, 0x48, 0x44, 0x52];
const HTML = [...'<html><body>hi</body></html>'].map((c) => c.charCodeAt(0));

let t: TestDatabase;
let owner: TestActor;
let treeId: string;
let personId: string;
let bucket: FakeMultipartBucket;

beforeAll(async () => {
	t = await createTestDatabase();
	owner = await createTestUser(t.db, 'owner');
	treeId = await createTestTree(t.db, owner);
	personId = crypto.randomUUID();
	await t.db.insert(individuals).values({ id: personId, treeId, givenName: 'Ada' });
}, 60_000);

afterAll(async () => {
	await t.dispose();
});

beforeEach(() => {
	bucket = new FakeMultipartBucket();
});

const r2 = () => bucket as unknown as R2Bucket;

/** Uploads `bytes` as one part of a media session and completes it; part size is the whole file. */
async function finished(bytes: number[], actor = owner): Promise<string> {
	const uploads = new UploadService(t.db, r2(), { partSizeBytes: bytes.length });
	const { sessionId } = await uploads.create(
		{
			treeId,
			purpose: 'media',
			fileName: 'x.png',
			contentType: 'image/png',
			totalBytes: bytes.length
		},
		actor.context
	);
	const body = new Response(new Uint8Array(bytes)).body!;
	await uploads.putPart(sessionId, 1, bytes.length, body, actor.context);
	await uploads.complete(sessionId, actor.context);
	return sessionId;
}

const service = () => new MediaService(t.db);

/** Sends `bytes` in `partSize` parts, last first, each through the CRC tap the route uses. */
async function finishedInParts(
	bytes: Uint8Array,
	partSize: number,
	isTapped: boolean
): Promise<string> {
	const uploads = new UploadService(t.db, r2(), { partSizeBytes: partSize });
	const { sessionId } = await uploads.create(
		{
			treeId,
			purpose: 'media',
			fileName: 'x.png',
			contentType: 'image/png',
			totalBytes: bytes.length
		},
		owner.context
	);
	const count = Math.ceil(bytes.length / partSize);
	for (let n = count; n >= 1; n--) {
		const piece = bytes.subarray((n - 1) * partSize, n * partSize);
		const tap = crc32Tap(new Response(piece).body!);
		await uploads.putPart(
			sessionId,
			n,
			piece.length,
			tap.body,
			owner.context,
			isTapped ? tap.crc32 : undefined
		);
	}
	await uploads.complete(sessionId, owner.context);
	return sessionId;
}

describe('MediaService.recordFromUpload checksums', () => {
	const whole = new Uint8Array([...PNG, ...Array.from({ length: 23 }, (_, i) => i * 7)]);

	it('stores the CRC combined from the parts and leaves the SHA-256 null', async () => {
		const sessionId = await finishedInParts(whole, 10, true);
		const media = await service().recordFromUpload(
			{ sessionId, entityId: personId, title: 'P' },
			r2(),
			owner.context
		);
		const row = await t.db.select().from(mediaItems).where(eq(mediaItems.id, media.id)).get();
		expect(row?.crc32).toBe(crc32(whole));
		expect(row?.sha256).toBeNull();
	});

	it('leaves the CRC null when a part was stored without one', async () => {
		const sessionId = await finishedInParts(whole, 10, false);
		const media = await service().recordFromUpload(
			{ sessionId, entityId: personId, title: 'P' },
			r2(),
			owner.context
		);
		const row = await t.db.select().from(mediaItems).where(eq(mediaItems.id, media.id)).get();
		expect(row?.crc32).toBeNull();
	});
});

describe('MediaService.recordFromUpload', () => {
	it('files the object under its final key with the sniffed type and removes the staged copy', async () => {
		const sessionId = await finished(PNG);
		const media = await service().recordFromUpload(
			{ sessionId, entityId: personId, title: 'Portrait' },
			r2(),
			owner.context
		);
		expect(media.objectKey).toMatch(new RegExp(`^media/${treeId}/${media.id}\\.png$`));
		expect(media.mimeType).toBe('image/png');
		const stored = bucket.objects.get(media.objectKey)!;
		expect(stored.contentType).toBe('image/png');
		expect([...stored.body]).toEqual(PNG);
		expect([...bucket.objects.keys()].filter((k) => k.startsWith('staging/'))).toEqual([]);
		const row = await t.db.select().from(mediaItems).where(eq(mediaItems.id, media.id)).get();
		expect(row).toMatchObject({
			title: 'Portrait',
			mimeType: 'image/png',
			sizeBytes: PNG.length,
			treeId
		});
	});

	it('refuses bytes that are not a supported type, whatever the name said', async () => {
		const sessionId = await finished(HTML);
		await expect(
			service().recordFromUpload(
				{ sessionId, entityId: personId, title: 'x.png' },
				r2(),
				owner.context
			)
		).rejects.toThrow(ValidationError);
		expect([...bucket.objects.keys()].some((k) => k.startsWith(`media/${treeId}/`))).toBe(false);
	});

	it('turns one upload into one file only', async () => {
		const sessionId = await finished(PNG);
		const input = { sessionId, entityId: personId, title: 'Once' };
		await service().recordFromUpload(input, r2(), owner.context);
		await expect(service().recordFromUpload(input, r2(), owner.context)).rejects.toThrow(
			ValidationError
		);
	});

	it('refuses a session that is still open', async () => {
		const uploads = new UploadService(t.db, r2(), { partSizeBytes: 10 });
		const { sessionId } = await uploads.create(
			{ treeId, purpose: 'media', fileName: 'x', contentType: '', totalBytes: 20 },
			owner.context
		);
		await expect(
			service().recordFromUpload({ sessionId, entityId: personId, title: 't' }, r2(), owner.context)
		).rejects.toThrow(ValidationError);
	});

	it('treats another user, a missing session and an import session alike as not found', async () => {
		const sessionId = await finished(PNG);
		const other = await createTestUser(t.db, 'second');
		await addTestMember(t.db, treeId, other, 'owner');
		const input = { entityId: personId, title: 't' };
		await expect(
			service().recordFromUpload({ ...input, sessionId }, r2(), other.context)
		).rejects.toThrow(NotFoundError);
		await expect(
			service().recordFromUpload({ ...input, sessionId: 'nope' }, r2(), owner.context)
		).rejects.toThrow(NotFoundError);

		const uploads = new UploadService(t.db, r2(), { partSizeBytes: 12 });
		const gdz = await uploads.create(
			{ treeId, purpose: 'gedzip_import', fileName: 'a.gdz', contentType: '', totalBytes: 12 },
			owner.context
		);
		await expect(
			service().recordFromUpload({ ...input, sessionId: gdz.sessionId }, r2(), owner.context)
		).rejects.toThrow(NotFoundError);
	});

	it('refuses a caller who lost the role, and a record outside the tree', async () => {
		const editor = await createTestUser(t.db, 'demoted');
		await addTestMember(t.db, treeId, editor, 'editor');
		const sessionId = await finished(PNG, editor);
		await expect(
			service().recordFromUpload(
				{ sessionId, entityId: 'not-in-tree', title: 't' },
				r2(),
				editor.context
			)
		).rejects.toThrow(ValidationError);
		await t.d1.exec("DELETE FROM tree_memberships WHERE role = 'editor'");
		await expect(
			service().recordFromUpload(
				{ sessionId, entityId: personId, title: 't' },
				r2(),
				editor.context
			)
		).rejects.toThrow();
	});

	it('refuses a file the tree has no room for', async () => {
		const sessionId = await finished(PNG);
		bucket.objects.set(`media/${treeId}/full.png`, {
			body: new Uint8Array(),
			size: MAX_TREE_MEDIA_BYTES
		});
		await expect(
			service().recordFromUpload({ sessionId, entityId: personId, title: 't' }, r2(), owner.context)
		).rejects.toThrow(PayloadTooLargeError);
	});
});
