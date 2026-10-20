/**
 * The serve route must never replay the stored content type. A legacy object uploaded as
 * `text/html` or `image/svg+xml` has to come back as an opaque, non-sniffable attachment, while a
 * real image is still served inline. It also revalidates rather than caching for a year, but never
 * before the caller has been authorized. A detached file (no owner) is editor-only, and a key with
 * no row is a missing object whatever its shape.
 */

import type { RequestEvent } from '@sveltejs/kit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { individuals, mediaItems } from '#lib/server/db/index.js';
import {
	addTestMember,
	createTestDatabase,
	createTestTree,
	createTestUser,
	type TestActor,
	type TestDatabase
} from '#lib/server/testing/d1.js';
import { FakeMediaBucket } from '#lib/server/testing/fake-bucket.js';
import { GET } from './+server.js';

interface FakeObject {
	contentType?: string;
	body: Uint8Array;
	httpEtag: string;
}

const HTML_BYTES = new TextEncoder().encode('<html><body>hi</body></html>');
const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PNG_OBJECT: FakeObject = { contentType: 'image/png', body: PNG_BYTES, httpEtag: '"v1"' };

let t: TestDatabase;
let treeId: string;
let personId: string;
let owner: TestActor;
let stranger: TestActor;
let editor: TestActor;
let viewer: TestActor;
let contributor: TestActor;
const bucket = new FakeMediaBucket();
/** Keys that already have a row, so each test can name a key without tripping over the others. */
const rowedKeys = new Set<string>();

beforeAll(async () => {
	t = await createTestDatabase();
	owner = await createTestUser(t.db, 'owner');
	stranger = await createTestUser(t.db, 'stranger');
	editor = await createTestUser(t.db, 'editor');
	viewer = await createTestUser(t.db, 'viewer');
	contributor = await createTestUser(t.db, 'contributor');
	treeId = await createTestTree(t.db, owner);
	await addTestMember(t.db, treeId, editor, 'editor');
	await addTestMember(t.db, treeId, viewer, 'viewer');
	await addTestMember(t.db, treeId, contributor, 'contributor');
	personId = crypto.randomUUID();
	await t.db.insert(individuals).values({ id: personId, treeId, givenName: 'Ada' });
}, 60_000);

afterAll(async () => {
	await t.dispose();
});

/** Gives an object key a row owned by `entityId`, once. `null` makes the file detached. */
async function ensureRow(key: string, entityId: string | null, title = 'x') {
	if (rowedKeys.has(key)) return;
	rowedKeys.add(key);
	await t.db.insert(mediaItems).values({
		id: crypto.randomUUID(),
		treeId,
		entityId,
		r2ObjectKey: key,
		title,
		mimeType: 'application/octet-stream'
	});
}

function fetchMedia(
	key: string,
	object: FakeObject | null,
	options: {
		ifNoneMatch?: string;
		actor?: TestActor;
		entityId?: string | null;
		title?: string;
	} = {}
) {
	const actor = options.actor ?? owner;
	bucket.objects.clear();
	if (object) {
		bucket.objects.set(key, {
			body: object.body,
			size: object.body.byteLength,
			contentType: object.contentType,
			httpEtag: object.httpEtag
		});
	}
	return ensureRow(
		key,
		options.entityId === undefined ? personId : options.entityId,
		options.title
	).then(() => {
		const event = {
			params: { key },
			request: new Request(`http://epoch.test/api/media/${key}`, {
				headers: options.ifNoneMatch ? { 'if-none-match': options.ifNoneMatch } : {}
			}),
			locals: { user: actor.context.user, correlationId: actor.context.correlationId },
			platform: { env: { DB: t.d1, MEDIA_BUCKET: bucket } },
			setHeaders: () => {}
		} as unknown as RequestEvent;
		return GET(event);
	});
}

function keyFor(name: string): string {
	return `media/${treeId}/${personId}/${name}`;
}

/** The current key shape: named by a media id, with no owner in it. */
function currentKey(): string {
	return `media/${treeId}/${crypto.randomUUID()}.png`;
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
		const response = await fetchMedia(keyFor('photo.png'), PNG_OBJECT);

		expect(response.status).toBe(200);
		expect(response.headers.get('content-type')).toBe('image/png');
		expect(response.headers.get('content-disposition')).toBe('inline');
	});

	it('serves a PDF inline, named after its title, without a sandbox CSP', async () => {
		const pdf = { contentType: 'application/pdf', body: HTML_BYTES, httpEtag: '"pdf"' };
		const key = keyFor('doc.pdf');
		const response = await fetchMedia(key, pdf, { title: '../Grandma\r\n"s will.docx' });

		expect(response.headers.get('content-type')).toBe('application/pdf');
		expect(response.headers.get('content-disposition')).toBe(
			`inline; filename="Grandma s will.pdf"; filename*=UTF-8''Grandma%20s%20will.pdf`
		);
		expect(response.headers.get('content-security-policy')).toBeNull();
		expect(response.headers.get('x-content-type-options')).toBe('nosniff');
		expect(response.headers.get('cross-origin-resource-policy')).toBe('same-origin');

		// The 304 carries the same headers as the 200.
		const cached = await fetchMedia(key, pdf, { ifNoneMatch: '"pdf"' });
		expect(cached.status).toBe(304);
		expect(cached.headers.get('content-disposition')).toBe(
			response.headers.get('content-disposition')
		);
		expect(cached.headers.get('content-security-policy')).toBeNull();
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

describe('media revalidation', () => {
	it('is private, no-cache and revalidated', async () => {
		const response = await fetchMedia(keyFor('photo.png'), PNG_OBJECT);
		expect(response.headers.get('cache-control')).toBe('private, no-cache');
	});

	it('answers 304 with no body when If-None-Match matches', async () => {
		const response = await fetchMedia(keyFor('photo.png'), PNG_OBJECT, { ifNoneMatch: '"v1"' });

		expect(response.status).toBe(304);
		expect(await response.text()).toBe('');
		expect(response.headers.get('etag')).toBe('"v1"');
		expect(response.headers.get('cache-control')).toBe('private, no-cache');
	});

	it('answers 200 with the body when If-None-Match differs', async () => {
		const response = await fetchMedia(keyFor('photo.png'), PNG_OBJECT, { ifNoneMatch: '"other"' });

		expect(response.status).toBe(200);
		expect((await response.arrayBuffer()).byteLength).toBe(PNG_BYTES.byteLength);
	});

	it('never answers 304 to a caller who may not read the object', async () => {
		const response = await fetchMedia(keyFor('photo.png'), PNG_OBJECT, {
			ifNoneMatch: '"v1"',
			actor: stranger
		});

		expect(response.status).not.toBe(304);
		expect(response.headers.get('cache-control')).toBe('no-store');
	});

	it('answers a missing object with 404 and no-store', async () => {
		const response = await fetchMedia(keyFor('absent.png'), null);

		expect(response.status).toBe(404);
		expect(response.headers.get('cache-control')).toBe('no-store');
	});
});

describe('media ownership in the serve path', () => {
	it('answers a detached file with 404 to a viewer and a contributor, and serves it to an editor', async () => {
		const key = currentKey();
		for (const actor of [viewer, contributor]) {
			const response = await fetchMedia(key, PNG_OBJECT, { actor, entityId: null });
			expect(response.status).toBe(404);
			expect(response.headers.get('cache-control')).toBe('no-store');
		}
		expect((await fetchMedia(key, PNG_OBJECT, { actor: editor, entityId: null })).status).toBe(200);
		expect((await fetchMedia(key, PNG_OBJECT, { actor: owner, entityId: null })).status).toBe(200);
	});

	it('answers a key with no row as missing, even for an owner, when the object exists', async () => {
		const key = `media/${treeId}/${crypto.randomUUID()}.png`;
		bucket.objects.set(key, { body: PNG_BYTES, size: PNG_BYTES.byteLength });
		const response = await GET({
			params: { key },
			request: new Request(`http://epoch.test/api/media/${key}`),
			locals: { user: owner.context.user, correlationId: owner.context.correlationId },
			platform: { env: { DB: t.d1, MEDIA_BUCKET: bucket } },
			setHeaders: () => {}
		} as unknown as RequestEvent);
		expect(response.status).toBe(404);
	});
});
