/**
 * Export download: it streams only a complete export, derives the key from the instance id, and
 * re-checks the retention window at read time. The headers are the hardened set the sync route uses.
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
let treeId: string;

beforeAll(async () => {
	t = await createTestDatabase();
	owner = await createTestUser(t.db, 'owner');
	treeId = await createTestTree(t.db, owner);
});
afterAll(async () => {
	await t.dispose();
});

function eventFor(instanceId: string, env: Record<string, unknown>): RequestEvent {
	const url = `http://epoch.test/api/export/download/${instanceId}`;
	return {
		request: new Request(url),
		url: new URL(url),
		params: { instanceId },
		locals: { user: owner.context.user, correlationId: owner.context.correlationId },
		platform: { env: { DB: t.d1, ...env } }
	} as unknown as RequestEvent;
}

function workflowAt(status: string) {
	const get = vi.fn(async (id: string) => ({ id, status: async () => ({ status }) }));
	return { workflow: { get }, get };
}

function bucketWithObject(object: unknown) {
	const get = vi.fn(async () => object);
	const remove = vi.fn(async () => {});
	return { bucket: { get, delete: remove }, get, remove };
}

const id = () => buildExportInstanceId(treeId, 'gedcom7', false, crypto.randomUUID());
const storedObject = () => ({
	uploaded: new Date(),
	customMetadata: { uploadedAt: new Date().toISOString() },
	httpMetadata: {
		contentType: 'text/vnd.familysearch.gedcom',
		contentDisposition: 'attachment; filename="Fox.ged"'
	},
	body: new Response('0 HEAD\n0 TRLR').body
});

describe('GET /api/export/download/[instanceId]', () => {
	it('answers the same 404 for an id it never minted', async () => {
		const { workflow } = workflowAt('complete');
		const { bucket } = bucketWithObject(storedObject());
		const response = await GET(
			eventFor('not-an-id', { GEDCOM_EXPORT_WORKFLOW: workflow, MEDIA_BUCKET: bucket })
		);
		expect(response.status).toBe(404);
	});

	it('refuses to stream an export that is not complete', async () => {
		const { workflow } = workflowAt('running');
		const { bucket, get } = bucketWithObject(storedObject());
		const response = await GET(
			eventFor(id(), { GEDCOM_EXPORT_WORKFLOW: workflow, MEDIA_BUCKET: bucket })
		);
		expect(response.status).toBe(409);
		expect(await response.json()).toEqual({ status: 'running', code: 'export_running' });
		expect(get).not.toHaveBeenCalled();
	});

	it('streams a complete export with the hardened headers and a doubly-named disposition', async () => {
		const { workflow } = workflowAt('complete');
		const { bucket } = bucketWithObject(storedObject());
		const response = await GET(
			eventFor(id(), { GEDCOM_EXPORT_WORKFLOW: workflow, MEDIA_BUCKET: bucket })
		);
		expect(response.status).toBe(200);
		expect(response.headers.get('Cache-Control')).toBe('private, no-store');
		expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
		const disposition = response.headers.get('Content-Disposition') ?? '';
		expect(disposition).toContain('attachment; filename="Fox.ged"');
		expect(disposition).toContain("filename*=UTF-8''Fox.ged");
		expect(await response.text()).toContain('0 HEAD');
	});

	it('answers 404 when the object a complete instance names is gone', async () => {
		const { workflow } = workflowAt('complete');
		const { bucket } = bucketWithObject(null);
		const response = await GET(
			eventFor(id(), { GEDCOM_EXPORT_WORKFLOW: workflow, MEDIA_BUCKET: bucket })
		);
		expect(response.status).toBe(404);
	});

	it('deletes an expired object and answers 410', async () => {
		const when = new Date(Date.now() - 2 * 86_400_000);
		const { workflow } = workflowAt('complete');
		const { bucket, remove } = bucketWithObject({
			...storedObject(),
			uploaded: when,
			customMetadata: { uploadedAt: when.toISOString() }
		});
		const response = await GET(
			eventFor(id(), { GEDCOM_EXPORT_WORKFLOW: workflow, MEDIA_BUCKET: bucket })
		);
		expect(response.status).toBe(410);
		expect(remove).toHaveBeenCalledTimes(1);
	});
});
