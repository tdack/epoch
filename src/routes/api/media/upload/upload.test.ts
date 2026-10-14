/**
 * The upload route must decide a file's type from its bytes. A file that claims to be HTML or SVG
 * (or lies about being a PNG) must be refused, and an accepted image must be stored under the
 * sniffed type, so it is served safely later (the stored-XSS fix). It must also bound the body
 * while it streams, so an oversized upload is refused before it is buffered whole.
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
import { MAX_MEDIA_UPLOAD_BYTES, MAX_TREE_MEDIA_BYTES } from '#lib/shared/media.js';
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

const UPLOAD_URL = 'http://localhost/api/media/upload';
const MULTIPART_BOUNDARY = 'epoch-upload-test';

/**
 * `size` is what a listing reports; a test sets it directly to fill a tree's quota without
 * allocating gigabytes.
 */
class FakeMediaBucket {
	readonly objects = new Map<string, { body: Uint8Array; size: number; contentType?: string }>();
	async put(
		key: string,
		value: Uint8Array | ArrayBuffer,
		options?: { httpMetadata?: { contentType?: string } }
	) {
		const body = value instanceof Uint8Array ? value : new Uint8Array(value);
		this.objects.set(key, {
			body,
			size: body.byteLength,
			contentType: options?.httpMetadata?.contentType
		});
		return { key, size: body.byteLength };
	}
	async list(options: { prefix?: string } = {}) {
		return {
			truncated: false as const,
			objects: [...this.objects.entries()]
				.filter(([key]) => key.startsWith(options.prefix ?? ''))
				.map(([key, found]) => ({ key, size: found.size }))
		};
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

function makeEvent(actor: TestActor, request: Request) {
	return {
		request,
		locals: { user: actor.context.user, correlationId: actor.context.correlationId },
		platform: { env: { DB: t.d1, MEDIA_BUCKET: bucket } }
	} as unknown as RequestEvent;
}

/** A real multipart request whose body Node can size, used for the type checks. */
function formRequest(form: FormData): Request {
	return new Request(UPLOAD_URL, { method: 'POST', body: form });
}

function upload(actor: TestActor, file: File) {
	const body = new FormData();
	body.set('file', file);
	body.set('treeId', treeId);
	body.set('entityId', personId);
	return POST(makeEvent(actor, formRequest(body)));
}

function multipartHeaders(): Headers {
	return new Headers({ 'content-type': `multipart/form-data; boundary=${MULTIPART_BOUNDARY}` });
}

/**
 * A request whose body is a raw multipart stream and, crucially, carries no `Content-Length` — as an
 * HTTP/2 or chunked client sends. The first part is a real `file` field, so the parser reads into it
 * until the route's limiter aborts the stream. `declaredLength` optionally supplies a header that
 * sits inside the slack window, proving the streaming count rather than the header is the control.
 */
function streamedOverCapUpload(declaredLength?: number): Request {
	const encoder = new TextEncoder();
	const head = encoder.encode(
		`--${MULTIPART_BOUNDARY}\r\n` +
			'Content-Disposition: form-data; name="file"; filename="big.png"\r\n' +
			'Content-Type: image/png\r\n\r\n'
	);
	const chunkBytes = 256 * 1024;
	const ceiling = MAX_MEDIA_UPLOAD_BYTES + 4 * 1024 * 1024;
	let streamedBytes = 0;
	const body = new ReadableStream<Uint8Array>({
		start(controller) {
			controller.enqueue(head);
			streamedBytes = head.byteLength;
		},
		pull(controller) {
			if (streamedBytes >= ceiling) {
				controller.close();
				return;
			}
			controller.enqueue(new Uint8Array(chunkBytes));
			streamedBytes += chunkBytes;
		}
	});
	const headers = multipartHeaders();
	if (declaredLength !== undefined) headers.set('content-length', String(declaredLength));
	return { headers, body } as unknown as Request;
}

/** A raw multipart request carrying only text fields, with no `Content-Length` header. */
function streamedFieldUpload(fields: Record<string, string>): Request {
	const parts = Object.entries(fields).map(
		([name, value]) =>
			`--${MULTIPART_BOUNDARY}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`
	);
	const bytes = new TextEncoder().encode(`${parts.join('')}--${MULTIPART_BOUNDARY}--\r\n`);
	const body = new ReadableStream<Uint8Array>({
		start(controller) {
			controller.enqueue(bytes);
			controller.close();
		}
	});
	return { headers: multipartHeaders(), body } as unknown as Request;
}

/** A stream that is not valid multipart at all. */
function malformedUpload(): Request {
	const body = new ReadableStream<Uint8Array>({
		start(controller) {
			controller.enqueue(new TextEncoder().encode('this is not multipart'));
			controller.close();
		}
	});
	return { headers: multipartHeaders(), body } as unknown as Request;
}

describe('media storage quota', () => {
	it('refuses an upload that would exceed the tree quota, before any byte is stored', async () => {
		bucket.objects.set(`media/${treeId}/${personId}/full.png`, {
			body: new Uint8Array(0),
			size: MAX_TREE_MEDIA_BYTES - 10
		});
		const response = await upload(owner, new File([PNG_BYTES], 'photo.png', { type: 'image/png' }));
		expect(response.status).toBe(413);
		expect(((await response.json()) as { code: string }).code).toBe('VALIDATION_ERROR');
		expect(bucket.objects.size).toBe(1);
	});

	it('does not count another tree toward this tree quota', async () => {
		const otherTreeId = await createTestTree(t.db, owner);
		bucket.objects.set(`media/${otherTreeId}/${personId}/full.png`, {
			body: new Uint8Array(0),
			size: MAX_TREE_MEDIA_BYTES
		});
		const response = await upload(owner, new File([PNG_BYTES], 'photo.png', { type: 'image/png' }));
		expect(response.status).toBe(201);
	});
});

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

describe('media upload size limits', () => {
	it('rejects an oversized Content-Length before reading the body', async () => {
		const headers = new Headers();
		headers.set('content-length', String(MAX_MEDIA_UPLOAD_BYTES + 1024 * 1024));
		const request = {
			headers,
			body: null,
			formData: async () => {
				throw new Error('the body must not be parsed');
			}
		} as unknown as Request;

		const response = await POST(makeEvent(owner, request));
		expect(response.status).toBe(413);
	});

	it('rejects a body streamed over the cap with no Content-Length', async () => {
		const response = await POST(makeEvent(owner, streamedOverCapUpload()));
		expect(response.status).toBe(413);
		expect(bucket.objects.size).toBe(0);
	});

	it('rejects a body over the cap even when Content-Length is inside the slack window', async () => {
		const response = await POST(
			makeEvent(owner, streamedOverCapUpload(MAX_MEDIA_UPLOAD_BYTES + 1))
		);
		expect(response.status).toBe(413);
	});

	it('does not reject a request that omits Content-Length', async () => {
		// HTTP/2 and browser FormData uploads may omit the header, so parsing must proceed rather
		// than answer 411. The streamed form has no `file`, so the missing-field check answers 400.
		const response = await POST(makeEvent(owner, streamedFieldUpload({ treeId })));
		expect(response.status).toBe(400);
	});

	it('maps a malformed multipart body to 400, not 500', async () => {
		const response = await POST(makeEvent(owner, malformedUpload()));
		expect(response.status).toBe(400);
	});

	it('rejects a text field named file with 400', async () => {
		const response = await POST(
			makeEvent(owner, streamedFieldUpload({ file: 'not-a-file', treeId, entityId: personId }))
		);
		expect(response.status).toBe(400);
		expect(bucket.objects.size).toBe(0);
	});
});
