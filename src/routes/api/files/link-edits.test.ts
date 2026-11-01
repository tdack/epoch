/**
 * The routes that edit a pointer: its title, and the order of the files on a record. Both go through
 * `MediaService`, so these tests cover the wiring, the version check and who may call them.
 */

import { eq } from 'drizzle-orm';
import type { RequestEvent } from '@sveltejs/kit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { individuals, mediaLinks } from '#lib/server/db/index.js';
import { MediaService } from '#lib/server/services/media-service.js';
import {
	addTestMember,
	createTestDatabase,
	createTestTree,
	createTestUser,
	type TestActor,
	type TestDatabase
} from '#lib/server/testing/d1.js';
import { PATCH } from './[id]/links/[entityId]/+server.js';
import { PUT } from './order/+server.js';

let t: TestDatabase;
let owner: TestActor;
let viewer: TestActor;
let treeId: string;
let personId: string;

beforeAll(async () => {
	t = await createTestDatabase();
	owner = await createTestUser(t.db, 'owner');
	viewer = await createTestUser(t.db, 'viewer');
	treeId = await createTestTree(t.db, owner);
	await addTestMember(t.db, treeId, viewer, 'viewer');
	personId = crypto.randomUUID();
	await t.db.insert(individuals).values({ id: personId, treeId, givenName: 'Ada' });
	for (const id of ['a', 'b'])
		await new MediaService(t.db).record(treeId, personId, {
			id: `file-${id}`,
			objectKey: `media/${treeId}/file-${id}.png`,
			title: id,
			mimeType: 'image/png',
			sizeBytes: 1,
			uploadedBy: owner.userId
		});
}, 60_000);

afterAll(async () => {
	await t.dispose();
});

function event(actor: TestActor | null, method: string, body: unknown, params = {}) {
	return {
		request: new Request('http://localhost/api/files', {
			method,
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(body)
		}),
		params,
		locals: actor
			? { user: actor.context.user, correlationId: actor.context.correlationId }
			: { correlationId: 'c' },
		platform: { env: { DB: t.d1 } }
	} as unknown as RequestEvent;
}

const linkOf = (file: string) =>
	t.db
		.select()
		.from(mediaLinks)
		.where(eq(mediaLinks.id, `${file}:${personId}`))
		.get();

describe('PATCH /api/files/[id]/links/[entityId]', () => {
	const params = { id: 'file-a', entityId: '' };

	it('sets the pointer title, and a blank one clears it', async () => {
		const p = { ...params, entityId: personId };
		const set = await PATCH(event(owner, 'PATCH', { treeId, title: ' Wedding ' }, p));
		expect(set.status).toBe(200);
		expect((await linkOf('file-a'))?.title).toBe('Wedding');
		await PATCH(event(owner, 'PATCH', { treeId, title: '  ' }, p));
		expect((await linkOf('file-a'))?.title).toBeNull();
	});

	it('refuses a stale version, a viewer, a signed-out caller and a missing link', async () => {
		const p = { ...params, entityId: personId };
		expect(
			(await PATCH(event(owner, 'PATCH', { treeId, title: 'x', version: 99 }, p))).status
		).toBe(409);
		expect((await PATCH(event(viewer, 'PATCH', { treeId, title: 'x' }, p))).status).toBe(403);
		expect((await PATCH(event(null, 'PATCH', { treeId, title: 'x' }, p))).status).toBe(401);
		expect(
			(await PATCH(event(owner, 'PATCH', { treeId, title: 'x', factId: 'no-fact' }, p))).status
		).toBe(404);
	});
});

describe('PUT /api/files/order', () => {
	it('writes the new order, and refuses a list that misses a file', async () => {
		const ok = await PUT(
			event(owner, 'PUT', { treeId, entityId: personId, orderedMediaIds: ['file-b', 'file-a'] })
		);
		expect(ok.status).toBe(200);
		expect((await linkOf('file-b'))?.sortOrder ?? 0).toBe(0);
		expect((await linkOf('file-a'))?.sortOrder).toBe(1);
		const bad = await PUT(
			event(owner, 'PUT', { treeId, entityId: personId, orderedMediaIds: ['file-a'] })
		);
		expect(bad.status).toBe(400);
		expect(
			(
				await PUT(
					event(viewer, 'PUT', {
						treeId,
						entityId: personId,
						orderedMediaIds: ['file-a', 'file-b']
					})
				)
			).status
		).toBe(403);
	});
});
