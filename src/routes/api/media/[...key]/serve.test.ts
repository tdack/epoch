/**
 * The serve route must never replay the stored content type. A legacy object uploaded as
 * `text/html` or `image/svg+xml` has to come back as an opaque, non-sniffable attachment, while a
 * real image is still served inline.
 */

import type { RequestEvent } from '@sveltejs/kit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { individuals, mediaItems } from '#lib/server/db/index.js';
import {
	createTestDatabase,
	createTestTree,
	createTestUser,
	type TestActor,
	type TestDatabase
} from '#lib/server/testing/d1.js';
import { GET } from './+server.js';

interface FakeObject {
	contentType?: string;
	body: Uint8Array;
	httpEtag: string;
}

class FakeReadBucket {
	constructor(private readonly object: FakeObject | null) {}

	async get(_key: string) {
		const object = this.object;
		if (!object) return null;
		const bytes = object.body;
		return {
			httpMetadata: { contentType: object.contentType },
			httpEtag: object.httpEtag,
			body: new ReadableStream({
				start(controller) {
					controller.enqueue(bytes);
					controller.close();
				}
			})
		};
	}
}

const HTML_BYTES = new TextEncoder().encode('<html><body>hi</body></html>');
const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

let t: TestDatabase;
let treeId: string;
let personId: string;
let owner: TestActor;

beforeAll(async () => {
	t = await createTestDatabase();
	owner = await createTestUser(t.db, 'owner');
	treeId = await createTestTree(t.db, owner);
	personId = crypto.randomUUID();
	await t.db.insert(individuals).values({ id: personId, treeId, givenName: 'Ada' });
	await t.db.insert(mediaItems).values({
		id: crypto.randomUUID(),
		treeId,
		entityId: personId,
		r2ObjectKey: `media/${treeId}/${personId}/object`,
		title: 'x',
		mimeType: 'application/octet-stream'
	});
}, 60_000);

afterAll(async () => {
	await t.dispose();
});

function fetchMedia(key: string, object: FakeObject | null) {
	const event = {
		params: { key },
		locals: { user: owner.context.user, correlationId: owner.context.correlationId },
		platform: { env: { DB: t.d1, MEDIA_BUCKET: new FakeReadBucket(object) } }
	} as unknown as RequestEvent;
	return GET(event);
}

function keyFor(name: string): string {
	return `media/${treeId}/${personId}/${name}`;
}

describe('media serve safety', () => {
	it('serves a legacy text/html object as an opaque attachment', async () => {
		const response = await fetchMedia(keyFor('evil.html'), {
			contentType: 'text/html',
			body: HTML_BYTES,
			httpEtag: '"abc"'
		});

		expect(response.status).toBe(200);
		expect(response.headers.get('content-type')).toBe('application/octet-stream');
		expect(response.headers.get('content-disposition')).toBe('attachment; filename="evil_html"');
		expect(response.headers.get('x-content-type-options')).toBe('nosniff');
		expect(response.headers.get('content-security-policy')).toBe('sandbox');
		expect(response.headers.get('cross-origin-resource-policy')).toBe('same-origin');
		expect(response.headers.get('referrer-policy')).toBe('no-referrer');
		expect(response.headers.get('etag')).toBe('"abc"');
	});

	it('serves a legacy image/svg+xml object as an opaque attachment', async () => {
		const response = await fetchMedia(keyFor('logo.svg'), {
			contentType: 'image/svg+xml',
			body: HTML_BYTES,
			httpEtag: '"svg"'
		});

		expect(response.headers.get('content-type')).toBe('application/octet-stream');
		expect(response.headers.get('content-disposition')).toBe('attachment; filename="logo_svg"');
		expect(response.headers.get('x-content-type-options')).toBe('nosniff');
	});

	it('serves a raster image inline', async () => {
		const response = await fetchMedia(keyFor('photo.png'), {
			contentType: 'image/png',
			body: PNG_BYTES,
			httpEtag: '"png"'
		});

		expect(response.status).toBe(200);
		expect(response.headers.get('content-type')).toBe('image/png');
		expect(response.headers.get('content-disposition')).toBe('inline');
	});

	it('emits no CR or LF in any response header', async () => {
		const response = await fetchMedia(keyFor('a"\r\nX-Evil.png'), {
			contentType: 'text/html',
			body: HTML_BYTES,
			httpEtag: '"crlf"'
		});

		for (const [, value] of response.headers) {
			expect(value).not.toMatch(/[\r\n]/);
		}
	});
});
