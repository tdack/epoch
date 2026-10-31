import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { getPlatformProxy } from 'wrangler';
import { treeMemberships } from '../db/schema';
import type { R2Bucket, R2ListOptions } from '@cloudflare/workers-types';
import { NotFoundError, PayloadTooLargeError, ValidationError } from '../domain/errors';
import { UploadRepository } from '../repositories/upload-repository';
import { FakeMultipartBucket } from '../testing/fake-multipart-bucket';
import {
	addTestMember,
	createTestDatabase,
	createTestTree,
	createTestUser,
	type TestActor,
	type TestDatabase
} from '../testing/d1';
import { MAX_TREE_MEDIA_BYTES } from '../../shared/media';
import { MAX_GEDZIP_UPLOAD_BYTES, UPLOAD_SESSION_TTL_SECONDS } from '../../shared/uploads';
import { UploadService } from './upload-service';

const PART = 10;

let t: TestDatabase;
let treeId: string;
let owner: TestActor;
let bucket: FakeMultipartBucket;
let clock: Date;

beforeAll(async () => {
	t = await createTestDatabase();
	owner = await createTestUser(t.db, 'owner');
	treeId = await createTestTree(t.db, owner);
}, 60_000);

afterAll(async () => {
	await t.dispose();
});

beforeEach(() => {
	bucket = new FakeMultipartBucket();
	clock = new Date('2026-06-01T00:00:00Z');
});

function service(b: R2Bucket = bucket as unknown as R2Bucket) {
	return new UploadService(t.db, b, { partSizeBytes: PART, now: () => clock });
}

function stream(bytes: number, fill = 1): ReadableStream<Uint8Array> {
	return new Response(new Uint8Array(bytes).fill(fill)).body!;
}

const media = (totalBytes: number) => ({
	treeId,
	purpose: 'media' as const,
	fileName: 'a.jpg',
	contentType: 'image/jpeg',
	totalBytes
});

describe('UploadService.create', () => {
	it('opens a session with server-chosen part urls and a key that ignores the file name', async () => {
		const dto = await service().create(media(25), owner.context);
		expect(dto.partCount).toBe(3);
		expect(dto.partSizeBytes).toBe(PART);
		expect(dto.parts[2]).toEqual({
			partNumber: 3,
			url: `/api/uploads/${dto.sessionId}/parts/3`,
			method: 'PUT'
		});
		expect(dto.expiresAt).toBe(clock.getTime() + UPLOAD_SESSION_TTL_SECONDS * 1000);
		const row = await new UploadRepository(t.db).find(dto.sessionId);
		expect(row?.r2Key).toBe(`staging/uploads/${treeId}/${dto.sessionId}`);
		expect(row?.createdBy).toBe(owner.userId);
	});

	it('refuses a user with no role in the tree, and a role too low for the purpose', async () => {
		const stranger = await createTestUser(t.db, 'stranger');
		await expect(service().create(media(5), stranger.context)).rejects.toThrow(/Forbidden/);
		const viewer = await createTestUser(t.db, 'viewer');
		await addTestMember(t.db, treeId, viewer, 'viewer');
		await expect(service().create(media(5), viewer.context)).rejects.toThrow(/Forbidden/);
		const contributor = await createTestUser(t.db, 'contributor');
		await addTestMember(t.db, treeId, contributor, 'contributor');
		await expect(
			service().create({ ...media(5), purpose: 'gedzip_import' }, contributor.context)
		).rejects.toThrow(/Forbidden/);
	});

	it('refuses a file over its purpose cap', async () => {
		await expect(service().create(media(MAX_TREE_MEDIA_BYTES + 1), owner.context)).rejects.toThrow(
			PayloadTooLargeError
		);
		await expect(
			service().create(
				{ ...media(MAX_GEDZIP_UPLOAD_BYTES + 1), purpose: 'gedzip_import' },
				owner.context
			)
		).rejects.toThrow(PayloadTooLargeError);
	});

	it('counts open sessions against the quota, so parallel sessions cannot overrun it', async () => {
		const quotaTree = await createTestTree(t.db, owner);
		const input = (bytes: number) => ({ ...media(bytes), treeId: quotaTree });
		const half = MAX_TREE_MEDIA_BYTES / 2;
		// A small part size would put this over R2's part cap, so the quota test uses the real one.
		const real = new UploadService(t.db, bucket as unknown as R2Bucket, { now: () => clock });
		await real.create(input(half), owner.context);
		await real.create(input(half), owner.context);
		await expect(real.create(input(1), owner.context)).rejects.toThrow(PayloadTooLargeError);
	});

	it('counts stored media against the quota too', async () => {
		const quotaTree = await createTestTree(t.db, owner);
		bucket.objects.set(`media/${quotaTree}/x.png`, {
			body: new Uint8Array(),
			size: MAX_TREE_MEDIA_BYTES - 5
		});
		const input = (bytes: number) => ({ ...media(bytes), treeId: quotaTree });
		await expect(service().create(input(6), owner.context)).rejects.toThrow(PayloadTooLargeError);
		await service().create(input(5), owner.context);
	});

	it('stops reserving room once a session expires', async () => {
		const quotaTree = await createTestTree(t.db, owner);
		const real = new UploadService(t.db, bucket as unknown as R2Bucket, { now: () => clock });
		const input = { ...media(MAX_TREE_MEDIA_BYTES), treeId: quotaTree };
		await real.create(input, owner.context);
		await expect(real.create(input, owner.context)).rejects.toThrow(PayloadTooLargeError);
		clock = new Date(clock.getTime() + (UPLOAD_SESSION_TTL_SECONDS + 1) * 1000);
		await real.create(input, owner.context);
	});

	it('gives imports no media quota', async () => {
		const quotaTree = await createTestTree(t.db, owner);
		bucket.objects.set(`media/${quotaTree}/x.png`, {
			body: new Uint8Array(),
			size: MAX_TREE_MEDIA_BYTES
		});
		await service().create(
			{ ...media(5), treeId: quotaTree, purpose: 'gedzip_import' },
			owner.context
		);
	});
});

describe('UploadService.putPart', () => {
	it('stores parts and completes into one object of the declared size', async () => {
		const svc = service();
		const { sessionId } = await svc.create(media(25), owner.context);
		const [a, b, c] = await Promise.all([
			svc.putPart(sessionId, 1, 10, stream(10, 1), owner.context),
			svc.putPart(sessionId, 2, 10, stream(10, 2), owner.context),
			svc.putPart(sessionId, 3, 5, stream(5, 3), owner.context)
		]);
		expect([a.partNumber, b.partNumber, c.partNumber]).toEqual([1, 2, 3]);
		const done = await svc.complete(sessionId, owner.context);
		expect(done).toEqual({
			sessionId,
			r2Key: `staging/uploads/${treeId}/${sessionId}`,
			totalBytes: 25
		});
		const stored = bucket.objects.get(done.r2Key)!.body;
		expect([...stored]).toEqual([...Array(10).fill(1), ...Array(10).fill(2), ...Array(5).fill(3)]);
		expect((await new UploadRepository(t.db).find(sessionId))?.status).toBe('complete');
	});

	it('refuses a part of the wrong size, including a full-size last part', async () => {
		const svc = service();
		const { sessionId } = await svc.create(media(25), owner.context);
		await expect(svc.putPart(sessionId, 1, 9, stream(9), owner.context)).rejects.toThrow(
			ValidationError
		);
		await expect(svc.putPart(sessionId, 3, 10, stream(10), owner.context)).rejects.toThrow(
			ValidationError
		);
		await expect(svc.putPart(sessionId, 1, null, stream(10), owner.context)).rejects.toThrow(
			/Content-Length/
		);
	});

	it('refuses a part number out of range', async () => {
		const svc = service();
		const { sessionId } = await svc.create(media(25), owner.context);
		for (const n of [0, 4, -1, 1.5]) {
			await expect(svc.putPart(sessionId, n, 10, stream(10), owner.context)).rejects.toThrow(
				ValidationError
			);
		}
	});

	it('refuses another user, even one with the role, as not found', async () => {
		const svc = service();
		const { sessionId } = await svc.create(media(10), owner.context);
		const editor = await createTestUser(t.db, 'editor');
		await addTestMember(t.db, treeId, editor, 'editor');
		const attempt = svc.putPart(sessionId, 1, 10, stream(10), editor.context);
		await expect(attempt).rejects.toThrow(NotFoundError);
		await expect(attempt).rejects.not.toThrow(sessionId);
		await expect(svc.complete(sessionId, editor.context)).rejects.toThrow(NotFoundError);
		await expect(svc.abort(sessionId, editor.context)).rejects.toThrow(NotFoundError);
	});

	it('refuses the creator once they have lost the role', async () => {
		const svc = service();
		const demoted = await createTestUser(t.db, 'demoted');
		await addTestMember(t.db, treeId, demoted, 'editor');
		const { sessionId } = await svc.create(media(10), demoted.context);
		await t.db
			.update(treeMemberships)
			.set({ role: 'viewer' })
			.where(eq(treeMemberships.userId, demoted.userId));
		await expect(svc.putPart(sessionId, 1, 10, stream(10), demoted.context)).rejects.toThrow(
			/Forbidden/
		);
	});

	it('refuses a part after the session expires', async () => {
		const svc = service();
		const { sessionId } = await svc.create(media(10), owner.context);
		clock = new Date(clock.getTime() + (UPLOAD_SESSION_TTL_SECONDS + 1) * 1000);
		await expect(svc.putPart(sessionId, 1, 10, stream(10), owner.context)).rejects.toThrow(
			/expired/
		);
		await expect(svc.complete(sessionId, owner.context)).rejects.toThrow(/expired/);
	});

	it('replaces a part that is sent again', async () => {
		const svc = service();
		const { sessionId } = await svc.create(media(10), owner.context);
		const first = await svc.putPart(sessionId, 1, 10, stream(10, 1), owner.context);
		const second = await svc.putPart(sessionId, 1, 10, stream(10, 9), owner.context);
		expect(second.etag).not.toBe(first.etag);
		expect((await new UploadRepository(t.db).find(sessionId))?.parts).toEqual({
			'1': second.etag
		});
		const done = await svc.complete(sessionId, owner.context);
		expect([...bucket.objects.get(done.r2Key)!.body]).toEqual(Array(10).fill(9));
	});
});

describe('UploadService.complete', () => {
	it('names the missing parts and leaves the session open', async () => {
		const svc = service();
		const { sessionId } = await svc.create(media(25), owner.context);
		await svc.putPart(sessionId, 2, 10, stream(10), owner.context);
		const attempt = svc.complete(sessionId, owner.context);
		await expect(attempt).rejects.toThrow(ValidationError);
		await expect(attempt).rejects.toMatchObject({ details: { missingParts: [1, 3] } });
		expect((await new UploadRepository(t.db).find(sessionId))?.status).toBe('open');
	});

	it('removes the object and fails when its size is not the declared one', async () => {
		const svc = service();
		const { sessionId } = await svc.create(media(10), owner.context);
		await svc.putPart(sessionId, 1, 10, stream(10), owner.context);
		const row = (await new UploadRepository(t.db).find(sessionId))!;
		const realHead = bucket.head.bind(bucket);
		bucket.head = async (key: string) => {
			const found = await realHead(key);
			return found && { ...found, size: found.size + 1 };
		};
		await expect(svc.complete(sessionId, owner.context)).rejects.toThrow(/declared/);
		expect(bucket.objects.has(row.r2Key)).toBe(false);
		expect((await new UploadRepository(t.db).find(sessionId))?.status).toBe('aborted');
	});

	it('cannot be completed twice', async () => {
		const svc = service();
		const { sessionId } = await svc.create(media(10), owner.context);
		await svc.putPart(sessionId, 1, 10, stream(10), owner.context);
		await svc.complete(sessionId, owner.context);
		await expect(svc.complete(sessionId, owner.context)).rejects.toThrow(/closed/);
	});
});

describe('UploadService.abort', () => {
	it('aborts once and is quiet the second time', async () => {
		const svc = service();
		const { sessionId } = await svc.create(media(10), owner.context);
		await svc.abort(sessionId, owner.context);
		await svc.abort(sessionId, owner.context);
		expect([...bucket.uploads.values()].map((u) => u.state)).toContain('aborted');
		expect((await new UploadRepository(t.db).find(sessionId))?.status).toBe('aborted');
		await expect(svc.putPart(sessionId, 1, 10, stream(10), owner.context)).rejects.toThrow(
			/closed/
		);
	});

	it('leaves a finished upload alone', async () => {
		const svc = service();
		const { sessionId } = await svc.create(media(10), owner.context);
		await svc.putPart(sessionId, 1, 10, stream(10), owner.context);
		const done = await svc.complete(sessionId, owner.context);
		await svc.abort(sessionId, owner.context);
		expect(bucket.objects.has(done.r2Key)).toBe(true);
		expect((await new UploadRepository(t.db).find(sessionId))?.status).toBe('complete');
	});

	it('refuses a session that does not exist', async () => {
		await expect(service().abort('nope', owner.context)).rejects.toThrow(NotFoundError);
	});
});

describe('against local R2 multipart', () => {
	it('runs the whole lifecycle through the real binding', async () => {
		const proxy = await getPlatformProxy<{ MEDIA_BUCKET: R2Bucket }>({
			configPath: new URL('../../../../wrangler.jsonc', import.meta.url).pathname,
			persist: false
		});
		try {
			const real = proxy.env.MEDIA_BUCKET;
			// Local R2 keeps R2's 5 MiB minimum part, and its binding refuses a Node stream of unknown
			// length (no FixedLengthStream outside workerd), so the parts go in as buffers.
			const FIVE_MIB = 5 * 1024 * 1024;
			const total = FIVE_MIB + 10;
			// Buffers the stream the service hands over, which is what the local binding will take.
			const buffering = {
				createMultipartUpload: (key: string) => real.createMultipartUpload(key),
				head: (key: string) => real.head(key),
				list: (options?: R2ListOptions) => real.list(options),
				resumeMultipartUpload: (key: string, uploadId: string) => {
					const upload = real.resumeMultipartUpload(key, uploadId);
					return {
						uploadPart: async (n: number, body: ReadableStream<Uint8Array>) =>
							upload.uploadPart(n, await new Response(body).arrayBuffer()),
						complete: (parts: Array<{ partNumber: number; etag: string }>) =>
							upload.complete(parts),
						abort: () => upload.abort()
					};
				}
			} as unknown as R2Bucket;
			const svc = new UploadService(t.db, buffering, { partSizeBytes: FIVE_MIB, now: () => clock });
			const { sessionId } = await svc.create(media(total), owner.context);
			const toStream = (bytes: Uint8Array) => new Response(bytes as BodyInit).body!;
			await svc.putPart(sessionId, 2, 10, toStream(new Uint8Array(10).fill(2)), owner.context);
			await svc.putPart(
				sessionId,
				1,
				FIVE_MIB,
				toStream(new Uint8Array(FIVE_MIB).fill(1)),
				owner.context
			);
			const done = await svc.complete(sessionId, owner.context);
			expect((await real.head(done.r2Key))?.size).toBe(total);
		} finally {
			await proxy.dispose();
		}
	}, 60_000);
});
