/**
 * Export routing: a small tree downloads synchronously; a large one starts a workflow instance and
 * never leaks the object key; a tree too large for any synchronous build is refused. Driven through
 * the handlers, so the test fails if the route stops checking the size or the role.
 */

import type { RequestEvent } from '@sveltejs/kit';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
	addTestMember,
	createTestDatabase,
	createTestTree,
	createTestUser,
	type TestActor,
	type TestDatabase
} from '#lib/server/testing/d1.js';
import { buildExportInstanceId } from '#lib/server/workflows/export-instance.js';
import { GET, POST } from './+server.js';

let t: TestDatabase;
let owner: TestActor;
let viewer: TestActor;
let small: string;
let large: string;
let huge: string;

/** Insert `count` bare people into a tree, chunked so no single statement is enormous. */
async function seedIndividuals(treeId: string, count: number): Promise<void> {
	const chunk = 250;
	for (let start = 0; start < count; start += chunk) {
		const values: string[] = [];
		for (let i = start; i < Math.min(start + chunk, count); i += 1) {
			values.push(`('seed-${treeId}-${i}', '${treeId}')`);
		}
		await t.d1.prepare(`INSERT INTO individuals (id, tree_id) VALUES ${values.join(',')}`).run();
	}
}

beforeAll(async () => {
	t = await createTestDatabase();
	owner = await createTestUser(t.db, 'owner');
	viewer = await createTestUser(t.db, 'viewer');
	small = await createTestTree(t.db, owner);
	large = await createTestTree(t.db, owner);
	huge = await createTestTree(t.db, owner);
	await addTestMember(t.db, small, viewer, 'viewer');
	await seedIndividuals(small, 2);
	await seedIndividuals(large, 5001);
	await seedIndividuals(huge, 50001);
}, 180_000);

afterAll(async () => {
	await t.dispose();
});

/** A workflow stand-in whose `create` and `get` a test dictates. */
function fakeWorkflow() {
	const create = vi.fn(async () => ({ id: 'made' }));
	const get = vi.fn(async (id: string) => ({ id, status: async () => ({ status: 'running' }) }));
	return { create, get, workflow: { create, get } };
}

/** A bucket stand-in for the collision path's `head`/`delete`. */
function fakeBucket(object: unknown) {
	const head = vi.fn(async () => object);
	const remove = vi.fn(async () => {});
	return { bucket: { head, delete: remove }, head, remove };
}

const freshObject = () => ({
	uploaded: new Date(),
	customMetadata: { uploadedAt: new Date().toISOString() }
});
const oldObject = () => {
	const when = new Date(Date.now() - 2 * 86_400_000);
	return { uploaded: when, customMetadata: { uploadedAt: when.toISOString() } };
};

function requestEvent(
	method: string,
	url: string,
	actor: TestActor,
	workflow?: unknown,
	body?: unknown,
	bucket?: unknown
): RequestEvent {
	return {
		request: new Request(url, {
			method,
			...(body === undefined
				? {}
				: { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
		}),
		url: new URL(url),
		params: {},
		locals: { user: actor.context.user, correlationId: actor.context.correlationId },
		platform: {
			env: {
				DB: t.d1,
				...(workflow ? { GEDCOM_EXPORT_WORKFLOW: workflow } : {}),
				...(bucket ? { MEDIA_BUCKET: bucket } : {})
			}
		}
	} as unknown as RequestEvent;
}

function post(actor: TestActor, body: unknown, workflow?: unknown, bucket?: unknown) {
	return POST(requestEvent('POST', 'http://epoch.test/api/export', actor, workflow, body, bucket));
}

function download(actor: TestActor, query: string, workflow?: unknown) {
	return GET(requestEvent('GET', `http://epoch.test/api/export?${query}`, actor, workflow));
}

const uuid = () => crypto.randomUUID();
const isExportUnavailable = (body: unknown) =>
	(body as { code?: string }).code === 'export_unavailable';

describe('POST /api/export', () => {
	it('answers `sync` for a small tree, without starting a workflow', async () => {
		const { create, workflow } = fakeWorkflow();
		const response = await post(owner, { treeId: small, clientUuid: uuid() }, workflow);
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ status: 'sync' });
		expect(create).not.toHaveBeenCalled();
	});

	it('answers `sync` for a small tree even when no workflow is bound', async () => {
		const response = await post(owner, { treeId: small, clientUuid: uuid() });
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ status: 'sync' });
	});

	it('answers `unavailable` for a large tree when no workflow is bound, with no sync fallback', async () => {
		const response = await post(owner, { treeId: large, clientUuid: uuid() });
		expect(response.status).toBe(503);
		expect(await response.json()).toEqual({ status: 'unavailable' });
	});

	it('refuses a tree beyond the sync ceiling with 413, workflow or not', async () => {
		const { create, workflow } = fakeWorkflow();
		const response = await post(owner, { treeId: huge, clientUuid: uuid() }, workflow);
		expect(response.status).toBe(413);
		expect((await response.json()) as { code: string }).toMatchObject({
			code: 'export_too_large'
		});
		// A tree above the ceiling must not start a workflow: it would only OOM and retry.
		expect(create).not.toHaveBeenCalled();
	});

	it('starts an instance for a large tree and returns only the instance id', async () => {
		const { create, workflow } = fakeWorkflow();
		const clientUuid = uuid();
		const response = await post(
			owner,
			{ treeId: large, clientUuid, format: 'gedcom7', shouldCompress: false },
			workflow
		);
		expect(response.status).toBe(200);
		const body = (await response.json()) as { status: string; instanceId: string };
		expect(body).toEqual({
			status: 'started',
			instanceId: buildExportInstanceId(large, 'gedcom7', false, clientUuid)
		});
		expect(body).not.toHaveProperty('fileKey');
		expect(create).toHaveBeenCalledWith({
			id: body.instanceId,
			params: { treeId: large, userId: owner.userId, format: 'gedcom7', shouldCompress: false },
			retention: { successRetention: '3 days', errorRetention: '7 days' }
		});
	});

	it('answers 410 when the collided instance finished but its file is gone', async () => {
		const clientUuid = uuid();
		const instanceId = buildExportInstanceId(large, 'gedcom7', false, clientUuid);
		const create = vi.fn(async () => {
			throw new Error('instance already exists');
		});
		const get = vi.fn(async () => ({
			id: instanceId,
			status: async () => ({ status: 'complete' })
		}));
		const { bucket } = fakeBucket(null);
		const response = await post(owner, { treeId: large, clientUuid }, { create, get }, bucket);
		expect(response.status).toBe(410);
		expect((await response.json()) as { code: string }).toMatchObject({ code: 'export_expired' });
	});

	it('deletes an aged-out collided object and answers 410', async () => {
		const clientUuid = uuid();
		const instanceId = buildExportInstanceId(large, 'gedcom7', false, clientUuid);
		const create = vi.fn(async () => {
			throw new Error('instance already exists');
		});
		const get = vi.fn(async () => ({
			id: instanceId,
			status: async () => ({ status: 'complete' })
		}));
		const { bucket, remove } = fakeBucket(oldObject());
		const response = await post(owner, { treeId: large, clientUuid }, { create, get }, bucket);
		expect(response.status).toBe(410);
		expect(remove).toHaveBeenCalledTimes(1);
	});

	it('answers started when the collided instance finished and its file is still fresh', async () => {
		const clientUuid = uuid();
		const instanceId = buildExportInstanceId(large, 'gedcom7', false, clientUuid);
		const create = vi.fn(async () => {
			throw new Error('instance already exists');
		});
		const get = vi.fn(async () => ({
			id: instanceId,
			status: async () => ({ status: 'complete' })
		}));
		const { bucket } = fakeBucket(freshObject());
		const response = await post(owner, { treeId: large, clientUuid }, { create, get }, bucket);
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ status: 'started', instanceId });
	});

	it('treats a create that failed because our own id is already running as started', async () => {
		const clientUuid = uuid();
		const instanceId = buildExportInstanceId(large, 'gedcom7', false, clientUuid);
		const create = vi.fn(async () => {
			throw new Error('instance already exists');
		});
		const get = vi.fn(async () => ({
			id: instanceId,
			status: async () => ({ status: 'running' })
		}));
		const response = await post(owner, { treeId: large, clientUuid }, { create, get });
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ status: 'started', instanceId });
	});

	it('refuses when the failed create cannot be confirmed as our live instance', async () => {
		const create = vi.fn(async () => {
			throw new Error('boom');
		});
		// The read-back names a different instance (a client-supplied id could never reach here, but
		// this proves the route does not trust the failure's text).
		const get = vi.fn(async () => ({
			id: 'someone-else',
			status: async () => ({ status: 'running' })
		}));
		const response = await post(owner, { treeId: large, clientUuid: uuid() }, { create, get });
		expect(response.status).toBe(503);
		expect(isExportUnavailable(await response.json())).toBe(true);
	});

	it('refuses when the read-back instance has errored', async () => {
		const clientUuid = uuid();
		const instanceId = buildExportInstanceId(large, 'gedcom7', false, clientUuid);
		const create = vi.fn(async () => {
			throw new Error('boom');
		});
		const get = vi.fn(async () => ({
			id: instanceId,
			status: async () => ({ status: 'errored' })
		}));
		const response = await post(owner, { treeId: large, clientUuid }, { create, get });
		expect(response.status).toBe(503);
		expect(isExportUnavailable(await response.json())).toBe(true);
	});

	it('requires a client uuid and refuses a viewer', async () => {
		const missing = await post(owner, { treeId: small }, fakeWorkflow().workflow);
		expect(missing.status).toBe(400);
		const refused = await post(
			viewer,
			{ treeId: small, clientUuid: uuid() },
			fakeWorkflow().workflow
		);
		expect(refused.status).toBe(403);
	});

	it('refuses a tree id that is not a uuid with 400, never reaching the workflow', async () => {
		const { create, workflow } = fakeWorkflow();
		const response = await post(owner, { treeId: 'not-a-uuid', clientUuid: uuid() }, workflow);
		expect(response.status).toBe(400);
		expect(create).not.toHaveBeenCalled();
	});
});

describe('GET /api/export', () => {
	it('serves a small tree with hardened headers and a doubly-named disposition', async () => {
		const response = await download(owner, `treeId=${small}&format=gedcom7`);
		expect(response.status).toBe(200);
		expect(response.headers.get('Cache-Control')).toBe('private, no-store');
		expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
		const disposition = response.headers.get('Content-Disposition') ?? '';
		expect(disposition).toContain('attachment; filename="');
		expect(disposition).toContain("filename*=UTF-8''");
		expect(await response.text()).toContain('0 HEAD');
	});

	it('refuses a large tree with 409 when a workflow is bound', async () => {
		const response = await download(owner, `treeId=${large}`, fakeWorkflow().workflow);
		expect(response.status).toBe(409);
		expect((await response.json()) as { code: string }).toMatchObject({ code: 'use_async' });
	});

	it('refuses a tree beyond the sync ceiling with 413, whatever is bound', async () => {
		const unbound = await download(owner, `treeId=${huge}`);
		expect(unbound.status).toBe(413);
		expect((await unbound.json()) as { code: string }).toMatchObject({
			code: 'sync_export_too_large'
		});
		// A bound workflow must not turn the ceiling into a 409: the tree cannot be built at all.
		const bound = await download(owner, `treeId=${huge}`, fakeWorkflow().workflow);
		expect(bound.status).toBe(413);
	});

	it('refuses a viewer', async () => {
		const response = await download(viewer, `treeId=${small}`);
		expect(response.status).toBe(403);
	});

	it('refuses a tree id that is not a uuid with 400, and never echoes it', async () => {
		const response = await download(owner, 'treeId=not-a-uuid');
		expect(response.status).toBe(400);
		const body = (await response.json()) as { error: string };
		expect(body.error).not.toContain('not-a-uuid');
	});
});
