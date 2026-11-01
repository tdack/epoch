/**
 * "Add file…" on an unresolved file (ADR-082 `resolve_media_file`): the bytes of a finished upload
 * session fill the row, the change is logged and undoable, and every refusal comes before a copy.
 */

import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { R2Bucket } from '@cloudflare/workers-types';
import { individuals, mediaItems, uploadSessions } from '../db/schema';
import {
	ConcurrencyConflictError,
	NotFoundError,
	PayloadTooLargeError,
	ValidationError
} from '../domain/errors';
import {
	addTestMember,
	createTestDatabase,
	createTestTree,
	createTestUser,
	type TestActor,
	type TestDatabase
} from '../testing/d1';
import { FakeMultipartBucket } from '../testing/fake-multipart-bucket';
import { MAX_MEDIA_FILE_BYTES, MAX_TREE_MEDIA_BYTES } from '../../shared/media';
import { MediaRepository } from '../repositories/media-repository';
import { ChangeLogService } from './change-log-service';
import { MediaService } from './media-service';
import { UploadService } from './upload-service';

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x49, 0x48, 0x44, 0x52];
const HTML = [...'<html><body>hi</body></html>'].map((c) => c.charCodeAt(0));

let t: TestDatabase;
let owner: TestActor;
let viewer: TestActor;
let treeId: string;
let personId: string;
let bucket: FakeMultipartBucket;
let fileCount = 0;

beforeAll(async () => {
	t = await createTestDatabase();
	owner = await createTestUser(t.db, 'owner');
	viewer = await createTestUser(t.db, 'viewer');
	treeId = await createTestTree(t.db, owner);
	await addTestMember(t.db, treeId, viewer, 'viewer');
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
const service = () => new MediaService(t.db);

/** An unresolved file on its own object, as the import writes one. */
async function unresolved(): Promise<string> {
	const id = `unresolved-${++fileCount}`;
	await new MediaRepository(t.db).insertUnresolved(treeId, {
		id,
		gedcomPath: 'photos/ada.png',
		mimeType: 'image/png',
		title: 'Ada'
	});
	return id;
}

async function finished(bytes: number[], actor = owner): Promise<string> {
	const uploads = new UploadService(t.db, r2(), { partSizeBytes: bytes.length });
	const { sessionId } = await uploads.create(
		{ treeId, purpose: 'media', fileName: 'x.png', contentType: '', totalBytes: bytes.length },
		actor.context
	);
	await uploads.putPart(
		sessionId,
		1,
		bytes.length,
		new Response(new Uint8Array(bytes)).body,
		actor.context
	);
	await uploads.complete(sessionId, actor.context);
	return sessionId;
}

const rowOf = (id: string) => t.db.select().from(mediaItems).where(eq(mediaItems.id, id)).get();

describe('MediaService.resolveFromUpload', () => {
	it('stores the bytes under the file id and fills the row', async () => {
		const fileId = await unresolved();
		const sessionId = await finished(PNG);
		const result = await service().resolveFromUpload({ sessionId, fileId }, r2(), owner.context);
		expect(result.change).not.toBeNull();
		const key = `media/${treeId}/${fileId}.png`;
		expect([...bucket.objects.get(key)!.body]).toEqual(PNG);
		expect(bucket.objects.get(key)!.contentType).toBe('image/png');
		expect(await rowOf(fileId)).toMatchObject({
			r2ObjectKey: key,
			status: null,
			mimeType: 'image/png',
			sizeBytes: PNG.length,
			// The path the file was written with is kept for the export.
			gedcomPath: 'photos/ada.png',
			version: 2
		});
		expect([...bucket.objects.keys()].filter((k) => k.startsWith('staging/'))).toEqual([]);
	});

	it('is undone to the unresolved row it was', async () => {
		const fileId = await unresolved();
		const sessionId = await finished(PNG);
		await service().resolveFromUpload({ sessionId, fileId }, r2(), owner.context);
		await new ChangeLogService(t.db).undoLast(treeId, owner.context);
		expect(await rowOf(fileId)).toMatchObject({
			status: 'unresolved',
			r2ObjectKey: `unresolved/${fileId}`,
			version: 3
		});
	});

	it('refuses a stale version and removes the copy it made', async () => {
		const fileId = await unresolved();
		const sessionId = await finished(PNG);
		await expect(
			service().resolveFromUpload({ sessionId, fileId, expectedVersion: 9 }, r2(), owner.context)
		).rejects.toThrow(ConcurrencyConflictError);
		expect([...bucket.objects.keys()].some((k) => k.startsWith(`media/${treeId}/`))).toBe(false);
		expect((await rowOf(fileId))?.status).toBe('unresolved');
	});

	it('refuses a file that already has its bytes', async () => {
		const fileId = await unresolved();
		await service().resolveFromUpload(
			{ sessionId: await finished(PNG), fileId },
			r2(),
			owner.context
		);
		await expect(
			service().resolveFromUpload({ sessionId: await finished(PNG), fileId }, r2(), owner.context)
		).rejects.toThrow(ValidationError);
	});

	it('refuses bytes that are not a supported type, whatever the name said', async () => {
		const fileId = await unresolved();
		await expect(
			service().resolveFromUpload({ sessionId: await finished(HTML), fileId }, r2(), owner.context)
		).rejects.toThrow(ValidationError);
		expect((await rowOf(fileId))?.status).toBe('unresolved');
	});

	it('refuses a file over the per-file cap', async () => {
		const fileId = await unresolved();
		const sessionId = await finished(PNG);
		await t.db
			.update(uploadSessions)
			.set({ totalBytes: MAX_MEDIA_FILE_BYTES + 1 })
			.where(eq(uploadSessions.id, sessionId));
		await expect(
			service().resolveFromUpload({ sessionId, fileId }, r2(), owner.context)
		).rejects.toThrow(PayloadTooLargeError);
	});

	it('refuses a file the tree has no room for', async () => {
		const fileId = await unresolved();
		const sessionId = await finished(PNG);
		bucket.objects.set(`media/${treeId}/full.png`, {
			body: new Uint8Array(),
			size: MAX_TREE_MEDIA_BYTES
		});
		await expect(
			service().resolveFromUpload({ sessionId, fileId }, r2(), owner.context)
		).rejects.toThrow(PayloadTooLargeError);
	});

	it("treats another user's session and a missing file as not found, and a viewer as refused", async () => {
		const fileId = await unresolved();
		const sessionId = await finished(PNG);
		await expect(
			service().resolveFromUpload({ sessionId, fileId }, r2(), viewer.context)
		).rejects.toThrow(NotFoundError);
		await expect(
			service().resolveFromUpload({ sessionId, fileId: 'nope' }, r2(), owner.context)
		).rejects.toThrow(NotFoundError);
	});
});
