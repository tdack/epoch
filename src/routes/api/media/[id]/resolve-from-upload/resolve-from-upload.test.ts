import type { RequestEvent } from '@sveltejs/kit';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { individuals } from '#lib/server/db/index.js';
import { MediaRepository } from '#lib/server/repositories/media-repository.js';
import { UploadService } from '#lib/server/services/upload-service.js';
import {
	addTestMember,
	createTestDatabase,
	createTestTree,
	createTestUser,
	type TestActor,
	type TestDatabase
} from '#lib/server/testing/d1.js';
import { FakeMultipartBucket } from '#lib/server/testing/fake-multipart-bucket.js';
import { POST } from './+server.js';

const PNG = new Uint8Array([
	0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x49, 0x48, 0x44, 0x52
]);

let t: TestDatabase;
let owner: TestActor;
let treeId: string;
let bucket: FakeMultipartBucket;
let count = 0;

beforeAll(async () => {
	t = await createTestDatabase();
	owner = await createTestUser(t.db, 'owner');
	treeId = await createTestTree(t.db, owner);
	await t.db.insert(individuals).values({ id: crypto.randomUUID(), treeId, givenName: 'Ada' });
}, 60_000);

afterAll(async () => {
	await t.dispose();
});

beforeEach(() => {
	bucket = new FakeMultipartBucket();
});

function call(actor: TestActor | null, fileId: string, body: unknown) {
	return POST({
		request: new Request(`http://localhost/api/media/${fileId}/resolve-from-upload`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(body)
		}),
		params: { id: fileId },
		locals: actor
			? { user: actor.context.user, correlationId: actor.context.correlationId }
			: { correlationId: 'c' },
		platform: { env: { DB: t.d1, MEDIA_BUCKET: bucket } }
	} as unknown as RequestEvent);
}

async function unresolved(): Promise<string> {
	const id = `route-unresolved-${++count}`;
	await new MediaRepository(t.db).insertUnresolved(treeId, {
		id,
		gedcomPath: 'a.png',
		mimeType: 'image/png'
	});
	return id;
}

async function finished(actor = owner): Promise<string> {
	const uploads = new UploadService(t.db, bucket as never, { partSizeBytes: PNG.length });
	const { sessionId } = await uploads.create(
		{ treeId, purpose: 'media', fileName: 'a.png', contentType: '', totalBytes: PNG.length },
		actor.context
	);
	await uploads.putPart(sessionId, 1, PNG.length, new Response(PNG).body, actor.context);
	await uploads.complete(sessionId, actor.context);
	return sessionId;
}

describe('POST /api/media/[id]/resolve-from-upload', () => {
	it('stores the bytes in the file and answers with the change', async () => {
		const fileId = await unresolved();
		const response = await call(owner, fileId, { sessionId: await finished() });
		expect(response.status).toBe(201);
		const body = (await response.json()) as { change: { id: string } | null };
		expect(body.change).not.toBeNull();
		expect(bucket.objects.has(`media/${treeId}/${fileId}.png`)).toBe(true);
	});

	it('is closed to a signed-out caller, a public visitor and another user', async () => {
		const fileId = await unresolved();
		const body = { sessionId: await finished() };
		expect((await call(null, fileId, body)).status).toBe(401);
		const visitor = await createTestUser(t.db, 'visitor');
		visitor.context.user.isPublicVisitor = true;
		expect((await call(visitor, fileId, body)).status).toBe(403);
		const other = await createTestUser(t.db, 'other');
		await addTestMember(t.db, treeId, other, 'owner');
		expect((await call(other, fileId, body)).status).toBe(404);
	});

	it('refuses a body that is not valid and a stale version', async () => {
		const fileId = await unresolved();
		expect((await call(owner, fileId, {})).status).toBe(400);
		const response = await call(owner, fileId, { sessionId: await finished(), version: 9 });
		expect(response.status).toBe(409);
	});
});
