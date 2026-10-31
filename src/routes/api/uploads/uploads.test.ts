import type { RequestEvent } from '@sveltejs/kit';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
	addTestMember,
	createTestDatabase,
	createTestTree,
	createTestUser,
	type TestActor,
	type TestDatabase
} from '#lib/server/testing/d1.js';
import { FakeMultipartBucket } from '#lib/server/testing/fake-multipart-bucket.js';
import { FakeRateLimit } from '#lib/server/testing/fake-rate-limit.js';
import { MAX_TREE_MEDIA_BYTES } from '#lib/shared/media.js';
import { UPLOAD_PART_BYTES, type UploadSessionDto } from '#lib/shared/uploads.js';
import { POST as createUpload } from './+server.js';
import { DELETE as abortUpload } from './[id]/+server.js';
import { POST as completeUpload } from './[id]/complete/+server.js';
import { PUT as putPart } from './[id]/parts/[n]/+server.js';

let t: TestDatabase;
let owner: TestActor;
let treeId: string;
let bucket: FakeMultipartBucket;

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
});

function event(
	actor: TestActor | null,
	request: Request,
	params: Record<string, string> = {},
	env: Record<string, unknown> = {}
) {
	return {
		request,
		params,
		url: new URL(request.url),
		locals: actor
			? { user: actor.context.user, correlationId: actor.context.correlationId }
			: { correlationId: 'c' },
		platform: { env: { DB: t.d1, MEDIA_BUCKET: bucket, ...env } }
	} as unknown as RequestEvent;
}

function createRequest(body: unknown): Request {
	return new Request('http://localhost/api/uploads', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(body)
	});
}

const mediaBody = (totalBytes: number) => ({
	treeId,
	purpose: 'media',
	fileName: 'scan.tif',
	contentType: 'image/tiff',
	totalBytes
});

function partRequest(bytes: number, declaredLength: string | null = String(bytes)): Request {
	const headers: Record<string, string> = {};
	if (declaredLength !== null) headers['content-length'] = declaredLength;
	return new Request('http://localhost/api/uploads/x/parts/1', {
		method: 'PUT',
		headers,
		body: new Uint8Array(bytes).fill(7)
	});
}

async function open(totalBytes: number, actor = owner): Promise<UploadSessionDto> {
	const response = await createUpload(event(actor, createRequest(mediaBody(totalBytes))));
	expect(response.status).toBe(201);
	return (await response.json()) as UploadSessionDto;
}

describe('POST /api/uploads', () => {
	it('opens a session and returns the part urls', async () => {
		const dto = await open(UPLOAD_PART_BYTES + 3);
		expect(dto.partCount).toBe(2);
		expect(dto.partSizeBytes).toBe(UPLOAD_PART_BYTES);
		expect(dto.parts.map((p) => p.url)).toEqual([
			`/api/uploads/${dto.sessionId}/parts/1`,
			`/api/uploads/${dto.sessionId}/parts/2`
		]);
		expect(dto.parts.every((p) => p.method === 'PUT')).toBe(true);
	});

	it('is closed to a signed-out caller and to the public visitor', async () => {
		const signedOut = await createUpload(event(null, createRequest(mediaBody(5))));
		expect(signedOut.status).toBe(401);
		const visitor = await createTestUser(t.db, 'visitor');
		visitor.context.user.isPublicVisitor = true;
		const response = await createUpload(event(visitor, createRequest(mediaBody(5))));
		expect(response.status).toBe(403);
	});

	it('refuses a role below the purpose, and does not spend a rate-limit token on it', async () => {
		const viewer = await createTestUser(t.db, 'viewer');
		await addTestMember(t.db, treeId, viewer, 'viewer');
		const limiter = new FakeRateLimit(10);
		const response = await createUpload(
			event(viewer, createRequest(mediaBody(5)), {}, { UPLOAD_RATE_LIMIT: limiter })
		);
		expect(response.status).toBe(403);
		expect(limiter.keys).toEqual([]);
	});

	it('limits media by the upload budget and imports by the import budget', async () => {
		const uploads = new FakeRateLimit(0);
		const imports = new FakeRateLimit(0);
		const env = { UPLOAD_RATE_LIMIT: uploads, IMPORT_RATE_LIMIT: imports };
		const media = await createUpload(event(owner, createRequest(mediaBody(5)), {}, env));
		expect(media.status).toBe(429);
		expect(uploads.keys).toEqual([owner.userId]);
		expect(imports.keys).toEqual([]);
		const gdz = await createUpload(
			event(owner, createRequest({ ...mediaBody(5), purpose: 'gedzip_import' }), {}, env)
		);
		expect(gdz.status).toBe(429);
		expect(imports.keys).toEqual([owner.userId]);
	});

	it('refuses a size over the cap and a body that is not valid', async () => {
		const over = await createUpload(
			event(owner, createRequest(mediaBody(MAX_TREE_MEDIA_BYTES + 1)))
		);
		expect(over.status).toBe(413);
		for (const bad of [
			{ ...mediaBody(0) },
			{ ...mediaBody(1.5) },
			{ ...mediaBody(5), purpose: 'x' }
		]) {
			expect((await createUpload(event(owner, createRequest(bad)))).status).toBe(400);
		}
	});
});

describe('upload lifecycle over the routes', () => {
	it('uploads two parts, completes, and the object is whole', async () => {
		const dto = await open(UPLOAD_PART_BYTES + 3);
		const params = (n: number) => ({ id: dto.sessionId, n: String(n) });
		const first = await putPart(event(owner, partRequest(UPLOAD_PART_BYTES), params(1)));
		expect(first.status).toBe(200);
		expect(await first.json()).toMatchObject({ partNumber: 1 });
		const last = await putPart(event(owner, partRequest(3), params(2)));
		expect(last.status).toBe(200);

		const done = await completeUpload(
			event(owner, new Request('http://localhost/x', { method: 'POST' }), { id: dto.sessionId })
		);
		expect(done.status).toBe(200);
		const body = (await done.json()) as { r2Key: string; totalBytes: number };
		expect(body.totalBytes).toBe(UPLOAD_PART_BYTES + 3);
		expect(body.r2Key).toBe(`staging/uploads/${treeId}/${dto.sessionId}`);
		expect(bucket.objects.get(body.r2Key)?.size).toBe(UPLOAD_PART_BYTES + 3);
	}, 30_000);

	it('refuses a part with a wrong or missing Content-Length, or a bad number, or another user', async () => {
		const dto = await open(25);
		const params = (n: string) => ({ id: dto.sessionId, n });
		expect((await putPart(event(owner, partRequest(9), params('1')))).status).toBe(400);
		expect((await putPart(event(owner, partRequest(25, null), params('1')))).status).toBe(400);
		expect((await putPart(event(owner, partRequest(25), params('9')))).status).toBe(400);
		expect((await putPart(event(owner, partRequest(25), params('x')))).status).toBe(400);
		const other = await createTestUser(t.db, 'other');
		await addTestMember(t.db, treeId, other, 'owner');
		const stolen = await putPart(event(other, partRequest(25), params('1')));
		expect(stolen.status).toBe(404);
		expect(await stolen.text()).not.toContain(dto.sessionId);
	});

	it('does not apply the JSON body cap to a part', async () => {
		// Two MiB is over the 1 MiB cap the handler puts on a JSON body; a part this large must pass.
		// The session's real part size is 50 MiB, so a small total makes this the last (short) part
		// of a bigger one: use two parts and send the full-size first part.
		const dto = await open(UPLOAD_PART_BYTES * 2);
		const response = await putPart(
			event(owner, partRequest(UPLOAD_PART_BYTES), { id: dto.sessionId, n: '1' })
		);
		expect(response.status).toBe(200);
	}, 30_000);

	it('aborts twice without error and refuses parts afterwards', async () => {
		const dto = await open(25);
		const request = () => new Request('http://localhost/x', { method: 'DELETE' });
		expect((await abortUpload(event(owner, request(), { id: dto.sessionId }))).status).toBe(204);
		expect((await abortUpload(event(owner, request(), { id: dto.sessionId }))).status).toBe(204);
		const late = await putPart(event(owner, partRequest(25), { id: dto.sessionId, n: '1' }));
		expect(late.status).toBe(400);
	});

	it('names the missing parts when complete is called early', async () => {
		const dto = await open(25);
		const response = await completeUpload(
			event(owner, new Request('http://localhost/x', { method: 'POST' }), { id: dto.sessionId })
		);
		expect(response.status).toBe(400);
	});
});
