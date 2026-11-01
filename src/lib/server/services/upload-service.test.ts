import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
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
import { MAX_MEDIA_FILE_BYTES, MAX_TREE_MEDIA_BYTES } from '../../shared/media';
import { MAX_GEDZIP_UPLOAD_BYTES, UPLOAD_SESSION_TTL_SECONDS } from '../../shared/uploads';
import { UPLOAD_SWEEP_BATCH_SIZE, UploadService } from './upload-service';

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
		await expect(service().create(media(MAX_MEDIA_FILE_BYTES + 1), owner.context)).rejects.toThrow(
			PayloadTooLargeError
		);
		const real = new UploadService(t.db, bucket as unknown as R2Bucket, { now: () => clock });
		const capTree = await createTestTree(t.db, owner);
		await real.create({ ...media(MAX_MEDIA_FILE_BYTES), treeId: capTree }, owner.context);
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
		// Stored media leaves room for exactly two files at the cap.
		bucket.objects.set(`media/${quotaTree}/x.png`, {
			body: new Uint8Array(),
			size: MAX_TREE_MEDIA_BYTES - 2 * MAX_MEDIA_FILE_BYTES
		});
		// A small part size would put this over R2's part cap, so the quota test uses the real one.
		const real = new UploadService(t.db, bucket as unknown as R2Bucket, { now: () => clock });
		await real.create(input(MAX_MEDIA_FILE_BYTES), owner.context);
		await real.create(input(MAX_MEDIA_FILE_BYTES), owner.context);
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
		bucket.objects.set(`media/${quotaTree}/x.png`, {
			body: new Uint8Array(),
			size: MAX_TREE_MEDIA_BYTES - MAX_MEDIA_FILE_BYTES
		});
		const real = new UploadService(t.db, bucket as unknown as R2Bucket, { now: () => clock });
		const input = { ...media(MAX_MEDIA_FILE_BYTES), treeId: quotaTree };
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

describe('UploadService.describe', () => {
	it('lists the parts that have arrived, in order, with the urls create gave', async () => {
		const svc = service();
		const opened = await svc.create(media(25), owner.context);
		await svc.putPart(opened.sessionId, 3, 5, stream(5), owner.context);
		await svc.putPart(opened.sessionId, 1, 10, stream(10), owner.context);
		const state = await svc.describe(opened.sessionId, owner.context);
		expect(state).toEqual({ ...opened, receivedParts: [1, 3] });
	});

	it('answers only the creator, as not found for anyone else', async () => {
		const svc = service();
		const { sessionId } = await svc.create(media(25), owner.context);
		const other = await createTestUser(t.db, 'describer');
		await addTestMember(t.db, treeId, other, 'owner');
		await expect(svc.describe(sessionId, other.context)).rejects.toThrow(NotFoundError);
	});

	it('refuses a closed or expired session', async () => {
		const svc = service();
		const { sessionId } = await svc.create(media(25), owner.context);
		clock = new Date(clock.getTime() + (UPLOAD_SESSION_TTL_SECONDS + 1) * 1000);
		await expect(svc.describe(sessionId, owner.context)).rejects.toThrow(ValidationError);
		await svc.abort(sessionId, owner.context);
		await expect(svc.describe(sessionId, owner.context)).rejects.toThrow(ValidationError);
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

describe('UploadService.sweepExpired', () => {
	const HOUR_MS = 60 * 60 * 1000;
	// Before every session the rest of this file opens, so their open sessions are never swept here.
	const SWEEP_AT = new Date('2025-01-01T00:00:00Z');

	beforeEach(() => {
		clock = SWEEP_AT;
	});

	/** An open session in R2 and in D1, expiring at `expiresAt`, as if `create` had opened it. */
	async function openSession(expiresAt: Date) {
		const id = crypto.randomUUID();
		const key = `staging/uploads/${treeId}/${id}`;
		const upload = await bucket.createMultipartUpload(key);
		await new UploadRepository(t.db).insert({
			id,
			treeId,
			purpose: 'media',
			r2Key: key,
			r2UploadId: upload.uploadId,
			partSizeBytes: PART,
			totalBytes: 25,
			createdBy: owner.userId,
			createdAt: clock,
			expiresAt
		});
		return { id, key, uploadId: upload.uploadId };
	}

	const statusOf = async (id: string) => (await new UploadRepository(t.db).find(id))!.status;
	const uploadStateOf = (uploadId: string) => bucket.uploads.get(uploadId)?.state;
	const expiredAt = (hoursAgo: number) => new Date(SWEEP_AT.getTime() - hoursAgo * HOUR_MS);
	const laterAt = (hoursAhead: number) => new Date(SWEEP_AT.getTime() + hoursAhead * HOUR_MS);

	it('closes expired open sessions and aborts their R2 uploads', async () => {
		const first = await openSession(expiredAt(1));
		const second = await openSession(expiredAt(2));

		const result = await service().sweepExpired();

		expect(result).toEqual({ closed: 2, abortFailed: 0 });
		expect(await statusOf(first.id)).toBe('aborted');
		expect(await statusOf(second.id)).toBe('aborted');
		expect(uploadStateOf(first.uploadId)).toBe('aborted');
		expect(uploadStateOf(second.uploadId)).toBe('aborted');
	});

	it('leaves unexpired, completed and already-aborted sessions untouched', async () => {
		const svc = service();
		const done = await svc.create(media(25), owner.context);
		for (const [partNumber, bytes] of [
			[1, 10],
			[2, 10],
			[3, 5]
		] as const) {
			await svc.putPart(done.sessionId, partNumber, bytes, stream(bytes), owner.context);
		}
		await svc.complete(done.sessionId, owner.context);
		const aborted = await svc.create(media(25), owner.context);
		await svc.abort(aborted.sessionId, owner.context);
		const doneRow = await new UploadRepository(t.db).find(done.sessionId);
		const abortedRow = await new UploadRepository(t.db).find(aborted.sessionId);
		const fresh = await openSession(laterAt(1));
		const expired = await openSession(expiredAt(1));

		expect(await svc.sweepExpired()).toEqual({ closed: 1, abortFailed: 0 });

		expect(await statusOf(expired.id)).toBe('aborted');
		expect(await statusOf(fresh.id)).toBe('open');
		expect(uploadStateOf(fresh.uploadId)).toBe('open');
		expect(await statusOf(done.sessionId)).toBe('complete');
		expect(uploadStateOf(doneRow!.r2UploadId)).toBe('completed');
		expect(await statusOf(aborted.sessionId)).toBe('aborted');
		expect(uploadStateOf(abortedRow!.r2UploadId)).toBe('aborted');
	});

	it('treats a session expiring exactly now as expired, as the upload itself does', async () => {
		const session = await openSession(SWEEP_AT);
		expect(await service().sweepExpired()).toEqual({ closed: 1, abortFailed: 0 });
		expect(await statusOf(session.id)).toBe('aborted');
	});

	it('closes a session whose R2 upload is already gone without counting it as a failure', async () => {
		const session = await openSession(expiredAt(1));
		await bucket.resumeMultipartUpload(session.key, session.uploadId).abort();
		const error = vi.spyOn(console, 'error').mockImplementation(() => {});

		expect(await service().sweepExpired()).toEqual({ closed: 1, abortFailed: 0 });
		expect(await statusOf(session.id)).toBe('aborted');
		expect(error).not.toHaveBeenCalled();
		error.mockRestore();
	});

	it('keeps going when one abort fails, closes that session too, and counts the failure', async () => {
		// The older session is swept first, so its failure comes before the other one's abort.
		const failing = await openSession(expiredAt(2));
		const after = await openSession(expiredAt(1));
		const realResume = bucket.resumeMultipartUpload.bind(bucket);
		vi.spyOn(bucket, 'resumeMultipartUpload').mockImplementation((key, uploadId) => {
			const upload = realResume(key, uploadId);
			if (uploadId !== failing.uploadId) return upload;
			return {
				...upload,
				abort: async () => {
					throw new Error('R2 is unavailable');
				}
			} as unknown as ReturnType<typeof realResume>;
		});
		const error = vi.spyOn(console, 'error').mockImplementation(() => {});

		try {
			expect(await service().sweepExpired()).toEqual({ closed: 2, abortFailed: 1 });
			expect(error).toHaveBeenCalledTimes(1);
		} finally {
			vi.restoreAllMocks();
		}

		expect(await statusOf(failing.id)).toBe('aborted');
		expect(await statusOf(after.id)).toBe('aborted');
		expect(uploadStateOf(after.uploadId)).toBe('aborted');
	});

	it('answers at most the limit, and a backlog drains over later runs', async () => {
		for (let i = 0; i < 5; i++) await openSession(expiredAt(1));
		const svc = service();

		expect(await svc.sweepExpired(2)).toEqual({ closed: 2, abortFailed: 0 });
		expect(await svc.sweepExpired(2)).toEqual({ closed: 2, abortFailed: 0 });
		expect(await svc.sweepExpired(2)).toEqual({ closed: 1, abortFailed: 0 });
		expect(await svc.sweepExpired(2)).toEqual({ closed: 0, abortFailed: 0 });
	});

	it('bounds a default run to UPLOAD_SWEEP_BATCH_SIZE sessions', async () => {
		for (let i = 0; i < UPLOAD_SWEEP_BATCH_SIZE + 1; i++) await openSession(expiredAt(1));
		const svc = service();

		expect((await svc.sweepExpired()).closed).toBe(UPLOAD_SWEEP_BATCH_SIZE);
		expect((await svc.sweepExpired()).closed).toBe(1);
	}, 60_000);
});
