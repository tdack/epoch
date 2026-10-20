/** The profile endpoints: who may call them, and what an upload must be to be stored. */

import type { RequestEvent } from '@sveltejs/kit';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PUBLIC_VISITOR } from '#lib/server/domain/identity.js';
import { FakeMediaBucket } from '#lib/server/testing/fake-bucket.js';
import { FakeRateLimit } from '#lib/server/testing/fake-rate-limit.js';
import {
	addTestMember,
	createTestDatabase,
	createTestTree,
	createTestUser,
	type TestActor,
	type TestDatabase
} from '#lib/server/testing/d1.js';
import { MAX_AVATAR_BYTES } from '#lib/shared/profile.js';
import { PUT } from './+server.js';
import { DELETE, POST } from './avatar/+server.js';
import { GET } from './avatar/[userId]/+server.js';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

let t: TestDatabase;
let bucket: FakeMediaBucket;
let me: TestActor;
let coMember: TestActor;
let stranger: TestActor;

beforeAll(async () => {
	t = await createTestDatabase();
	me = await createTestUser(t.db, 'me');
	coMember = await createTestUser(t.db, 'co');
	stranger = await createTestUser(t.db, 'stranger');
	const treeId = await createTestTree(t.db, me);
	await addTestMember(t.db, treeId, coMember, 'viewer');
}, 60_000);
afterAll(async () => {
	await t.dispose();
});
beforeEach(() => {
	bucket = new FakeMediaBucket();
});

function event(
	actor: TestActor | null,
	request: Request,
	extra: { params?: Record<string, string>; limiter?: FakeRateLimit } = {}
) {
	return {
		request,
		url: new URL(request.url),
		params: extra.params ?? {},
		locals: {
			user: actor === null ? PUBLIC_VISITOR : actor.context.user,
			correlationId: 'profile-test'
		},
		platform: { env: { DB: t.d1, MEDIA_BUCKET: bucket, UPLOAD_RATE_LIMIT: extra.limiter } }
	} as unknown as RequestEvent;
}

function uploadRequest(file: File | string) {
	const form = new FormData();
	form.set('file', file);
	return new Request('http://localhost/api/profile/avatar', { method: 'POST', body: form });
}

const upload = (actor: TestActor | null, file: File | string, limiter?: FakeRateLimit) =>
	POST(event(actor, uploadRequest(file), { limiter }));
const read = (actor: TestActor | null, userId: string) =>
	GET(
		event(actor, new Request(`http://localhost/api/profile/avatar/${userId}`), {
			params: { userId }
		})
	);

describe('POST /api/profile/avatar', () => {
	it('stores a PNG and serves it back privately to its owner', async () => {
		const response = await upload(me, new File([PNG], 'me.png', { type: 'image/png' }));
		expect(response.status).toBe(200);
		const served = await read(me, me.userId);
		expect(served.status).toBe(200);
		expect(served.headers.get('content-type')).toBe('image/png');
		expect(served.headers.get('cache-control')).toContain('private');
	});

	it('ignores the declared type: HTML and SVG are refused', async () => {
		for (const [bytes, type] of [
			['<html><body>x</body></html>', 'image/png'],
			['<svg xmlns="http://www.w3.org/2000/svg"></svg>', 'image/svg+xml']
		]) {
			const response = await upload(me, new File([bytes], 'x', { type }));
			expect(response.status).toBe(400);
		}
		expect(bucket.objects.size).toBe(0);
	});

	it('refuses a file over 2 MB with 413', async () => {
		const big = new Uint8Array(MAX_AVATAR_BYTES + 1);
		big.set(PNG);
		expect((await upload(me, new File([big], 'big.png', { type: 'image/png' }))).status).toBe(413);
		expect(bucket.objects.size).toBe(0);
	});

	it('refuses a text field named file', async () => {
		expect((await upload(me, 'not a file')).status).toBe(400);
	});

	it('is rate limited, and refused for the public visitor', async () => {
		const limiter = new FakeRateLimit(0);
		expect((await upload(me, new File([PNG], 'a.png'), limiter)).status).toBe(429);
		expect((await upload(null, new File([PNG], 'a.png'))).status).toBe(403);
	});
});

describe('GET /api/profile/avatar/[userId]', () => {
	beforeEach(async () => {
		await upload(me, new File([PNG], 'me.png', { type: 'image/png' }));
	});

	it('serves the owner and a co-member', async () => {
		expect((await read(me, me.userId)).status).toBe(200);
		expect((await read(coMember, me.userId)).status).toBe(200);
	});

	it('refuses a stranger and the public visitor', async () => {
		expect((await read(stranger, me.userId)).status).toBe(403);
		expect((await read(null, me.userId)).status).toBe(403);
	});
});

describe('DELETE /api/profile/avatar and PUT /api/profile', () => {
	it('removes the picture', async () => {
		await upload(me, new File([PNG], 'me.png'));
		const response = await DELETE(
			event(me, new Request('http://localhost/api/profile/avatar', { method: 'DELETE' }))
		);
		expect(response.status).toBe(200);
		expect(bucket.objects.size).toBe(0);
		expect((await read(me, me.userId)).status).toBe(404);
	});

	it('saves a trimmed name, rejects an empty or too-long one, and refuses the visitor', async () => {
		const put = (actor: TestActor | null, name: string) =>
			PUT(
				event(
					actor,
					new Request('http://localhost/api/profile', {
						method: 'PUT',
						body: JSON.stringify({ name })
					})
				)
			);
		const ok = await put(me, '  Ada  ');
		expect(ok.status).toBe(200);
		expect(((await ok.json()) as { name: string }).name).toBe('Ada');
		expect((await put(me, '   ')).status).toBe(400);
		expect((await put(me, 'x'.repeat(101))).status).toBe(400);
		expect((await put(null, 'Ada')).status).toBe(403);
	});
});
