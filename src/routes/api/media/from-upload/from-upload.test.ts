import type { RequestEvent } from '@sveltejs/kit';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { individuals } from '#lib/server/db/index.js';
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

function call(actor: TestActor | null, body: unknown) {
	return POST({
		request: new Request('http://localhost/api/media/from-upload', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(body)
		}),
		params: {},
		locals: actor
			? { user: actor.context.user, correlationId: actor.context.correlationId }
			: { correlationId: 'c' },
		platform: { env: { DB: t.d1, MEDIA_BUCKET: bucket } }
	} as unknown as RequestEvent);
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

describe('POST /api/media/from-upload', () => {
	it('creates the file and answers like the form upload', async () => {
		const sessionId = await finished();
		const response = await call(owner, { sessionId, entityId: personId, title: 'Ada.png' });
		expect(response.status).toBe(201);
		const { media } = (await response.json()) as { media: { objectKey: string; mimeType: string } };
		expect(media.mimeType).toBe('image/png');
		expect(bucket.objects.has(media.objectKey)).toBe(true);
	});

	it('is closed to a signed-out caller, a public visitor and another user', async () => {
		const sessionId = await finished();
		const body = { sessionId, entityId: personId, title: 't' };
		expect((await call(null, body)).status).toBe(401);
		const visitor = await createTestUser(t.db, 'visitor');
		visitor.context.user.isPublicVisitor = true;
		expect((await call(visitor, body)).status).toBe(403);
		const other = await createTestUser(t.db, 'other');
		await addTestMember(t.db, treeId, other, 'owner');
		expect((await call(other, body)).status).toBe(404);
	});

	it('refuses a body that is not valid', async () => {
		expect((await call(owner, { sessionId: 'x', entityId: personId, title: '' })).status).toBe(400);
		expect((await call(owner, { entityId: personId, title: 't' })).status).toBe(400);
	});
});
