/**
 * The upload route must decide a file's type from its bytes. A file that claims to be HTML or SVG
 * (or lies about being a PNG) must be refused, and an accepted image must be stored under the
 * sniffed type, so it is served safely later (the stored-XSS fix).
 */

import { eq } from 'drizzle-orm';
import type { RequestEvent } from '@sveltejs/kit';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { individuals, mediaItems } from '#lib/server/db/index.js';
import {
	createTestDatabase,
	createTestTree,
	createTestUser,
	type TestActor,
	type TestDatabase
} from '#lib/server/testing/d1.js';
import { POST } from './+server.js';

function ascii(text: string): number[] {
	return [...text].map((char) => char.charCodeAt(0));
}

const PNG_BYTES = new Uint8Array([
	0x89,
	0x50,
	0x4e,
	0x47,
	0x0d,
	0x0a,
	0x1a,
	0x0a,
	...ascii('IHDR')
]);
const HTML_BYTES = new Uint8Array(ascii('<html><body>hi</body></html>'));
const SVG_BYTES = new Uint8Array(ascii('<svg xmlns="http://www.w3.org/2000/svg"></svg>'));

class FakeMediaBucket {
	readonly objects = new Map<string, { body: Uint8Array; contentType?: string }>();
	async put(
		key: string,
		value: Uint8Array | ArrayBuffer,
		options?: { httpMetadata?: { contentType?: string } }
	) {
		const body = value instanceof Uint8Array ? value : new Uint8Array(value);
		this.objects.set(key, { body, contentType: options?.httpMetadata?.contentType });
		return { key, size: body.byteLength };
	}
}

let t: TestDatabase;
let treeId: string;
let personId: string;
let owner: TestActor;
let bucket: FakeMediaBucket;

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
	bucket = new FakeMediaBucket();
});

function upload(actor: TestActor, file: File) {
	const body = new FormData();
	body.set('file', file);
	body.set('treeId', treeId);
	body.set('entityId', personId);
	const event = {
		request: new Request('http://epoch.test/api/media/upload', { method: 'POST', body }),
		locals: { user: actor.context.user, correlationId: actor.context.correlationId },
		platform: { env: { DB: t.d1, MEDIA_BUCKET: bucket } }
	} as unknown as RequestEvent;
	return POST(event);
}

describe('media upload type checks', () => {
	it('refuses HTML bytes even when the declared type says image/png', async () => {
		const response = await upload(
			owner,
			new File([HTML_BYTES], 'photo.png', { type: 'image/png' })
		);
		expect(response.status).toBe(400);
		expect(bucket.objects.size).toBe(0);
	});

	it('refuses SVG bytes', async () => {
		const response = await upload(
			owner,
			new File([SVG_BYTES], 'logo.svg', { type: 'image/svg+xml' })
		);
		expect(response.status).toBe(400);
		expect(bucket.objects.size).toBe(0);
	});

	it('stores an accepted image under the sniffed type, not the declared one', async () => {
		const response = await upload(
			owner,
			new File([PNG_BYTES], 'photo.txt', { type: 'application/octet-stream' })
		);
		expect(response.status).toBe(201);
		const body = (await response.json()) as {
			media: { id: string; objectKey: string; mimeType: string };
		};
		expect(body.media.mimeType).toBe('image/png');
		expect(body.media.objectKey).toMatch(/\.png$/);

		const stored = bucket.objects.get(body.media.objectKey);
		expect(stored?.contentType).toBe('image/png');

		const row = await t.db
			.select({ mimeType: mediaItems.mimeType })
			.from(mediaItems)
			.where(eq(mediaItems.id, body.media.id))
			.get();
		expect(row?.mimeType).toBe('image/png');
	});
});
