/**
 * Export status: authorization precedes every workflow and R2 read, and the answer is a closed
 * `{ status, code }` that never carries the workflow's own error or the object key.
 */

import type { RequestEvent } from '@sveltejs/kit';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
	createTestDatabase,
	createTestTree,
	createTestUser,
	type TestActor,
	type TestDatabase
} from '#lib/server/testing/d1.js';
import { buildExportInstanceId } from '#lib/server/workflows/export-instance.js';
import { GET } from './+server.js';

let t: TestDatabase;
let owner: TestActor;
let stranger: TestActor;
let treeId: string;

beforeAll(async () => {
	t = await createTestDatabase();
	owner = await createTestUser(t.db, 'owner');
	stranger = await createTestUser(t.db, 'stranger');
	treeId = await createTestTree(t.db, owner);
});
afterAll(async () => {
	await t.dispose();
});

function eventFor(
	instanceId: string,
	actor: TestActor | null,
	env: Record<string, unknown>
): RequestEvent {
	const url = `http://epoch.test/api/export/status/${instanceId}`;
	return {
		request: new Request(url),
		url: new URL(url),
		params: { instanceId },
		locals: actor
			? { user: actor.context.user, correlationId: actor.context.correlationId }
			: { user: null, correlationId: 'anonymous' },
		platform: { env: { DB: t.d1, ...env } }
	} as unknown as RequestEvent;
}

function workflowAt(status: string) {
	const get = vi.fn(async (id: string) => ({ id, status: async () => ({ status }) }));
	return { workflow: { get }, get };
}

function bucketWithHead(object: unknown) {
	const head = vi.fn(async () => object);
	const remove = vi.fn(async () => {});
	return { bucket: { head, delete: remove }, head, remove };
}

const id = () => buildExportInstanceId(treeId, 'gedcom7', false, crypto.randomUUID());
const freshObject = () => ({
	uploaded: new Date(),
	customMetadata: { uploadedAt: new Date().toISOString() }
});
const oldObject = () => {
	const when = new Date(Date.now() - 2 * 86_400_000);
	return { uploaded: when, customMetadata: { uploadedAt: when.toISOString() } };
};

describe('GET /api/export/status/[instanceId]', () => {
	it('needs a signed-in caller', async () => {
		const { workflow } = workflowAt('running');
		const response = await GET(eventFor(id(), null, { GEDCOM_EXPORT_WORKFLOW: workflow }));
		expect(response.status).toBe(401);
	});

	it('answers unavailable when the workflow binding is absent', async () => {
		const response = await GET(eventFor(id(), owner, {}));
		expect(response.status).toBe(503);
	});

	it('answers the same 404 for an id it never minted and for a stranger’s tree', async () => {
		const { workflow } = workflowAt('running');
		const { bucket } = bucketWithHead(null);
		const env = { GEDCOM_EXPORT_WORKFLOW: workflow, MEDIA_BUCKET: bucket };
		expect((await GET(eventFor('not-an-id', owner, env))).status).toBe(404);
		expect((await GET(eventFor(id(), stranger, env))).status).toBe(404);
	});

	it('maps every in-flight state to running, and queued to queued', async () => {
		const cases: Array<[string, string]> = [
			['queued', 'queued'],
			['running', 'running'],
			['paused', 'running'],
			['waiting', 'running'],
			['waitingForPause', 'running'],
			['rollingBack', 'running']
		];
		for (const [status, expected] of cases) {
			const { workflow } = workflowAt(status);
			const { bucket } = bucketWithHead(null);
			const response = await GET(
				eventFor(id(), owner, { GEDCOM_EXPORT_WORKFLOW: workflow, MEDIA_BUCKET: bucket })
			);
			const body = (await response.json()) as Record<string, unknown>;
			expect(body, status).toEqual({ status: expected, code: `export_${expected}` });
		}
	});

	it('reports complete only once the object is there and fresh, with no key in the answer', async () => {
		const { workflow } = workflowAt('complete');
		const { bucket } = bucketWithHead(freshObject());
		const response = await GET(
			eventFor(id(), owner, { GEDCOM_EXPORT_WORKFLOW: workflow, MEDIA_BUCKET: bucket })
		);
		const body = (await response.json()) as Record<string, unknown>;
		expect(Object.keys(body).sort()).toEqual(['code', 'status']);
		expect(body).toEqual({ status: 'complete', code: 'export_complete' });
	});

	it('reports errored when a complete instance’s object is gone', async () => {
		const { workflow } = workflowAt('complete');
		const { bucket } = bucketWithHead(null);
		const response = await GET(
			eventFor(id(), owner, { GEDCOM_EXPORT_WORKFLOW: workflow, MEDIA_BUCKET: bucket })
		);
		expect(await response.json()).toEqual({ status: 'errored', code: 'export_errored' });
	});

	it('deletes an expired object and answers 410', async () => {
		const { workflow } = workflowAt('complete');
		const { bucket, remove } = bucketWithHead(oldObject());
		const response = await GET(
			eventFor(id(), owner, { GEDCOM_EXPORT_WORKFLOW: workflow, MEDIA_BUCKET: bucket })
		);
		expect(response.status).toBe(410);
		expect((await response.json()) as { code: string }).toMatchObject({ code: 'export_expired' });
		expect(remove).toHaveBeenCalledTimes(1);
	});

	it('removes an orphaned object and answers 404 when the instance has been purged', async () => {
		const get = vi.fn(async () => {
			throw new Error('instance not found');
		});
		const { bucket, remove } = bucketWithHead(freshObject());
		const response = await GET(
			eventFor(id(), owner, { GEDCOM_EXPORT_WORKFLOW: { get }, MEDIA_BUCKET: bucket })
		);
		expect(response.status).toBe(404);
		expect(remove).toHaveBeenCalledTimes(1);
	});

	it('answers 404 without deleting when a purged instance left no object', async () => {
		const get = vi.fn(async () => {
			throw new Error('instance not found');
		});
		const { bucket, remove } = bucketWithHead(null);
		const response = await GET(
			eventFor(id(), owner, { GEDCOM_EXPORT_WORKFLOW: { get }, MEDIA_BUCKET: bucket })
		);
		expect(response.status).toBe(404);
		expect(remove).not.toHaveBeenCalled();
	});
});
