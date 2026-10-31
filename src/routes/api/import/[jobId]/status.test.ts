/**
 * Import status: a member of the job's tree reads it, anyone else gets the same 404 as for an id
 * that never existed, and the signed out are refused. The 202 that starts a job is covered here too,
 * since the two routes share a contract.
 */

import type { RequestEvent } from '@sveltejs/kit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ImportJobService } from '#lib/server/services/import-job-service.js';
import {
	addTestMember,
	createTestDatabase,
	createTestTree,
	createTestUser,
	type TestActor,
	type TestDatabase
} from '#lib/server/testing/d1.js';
import { POST } from '../+server.js';
import { GET } from './+server.js';

let t: TestDatabase;
let owner: TestActor;
let viewer: TestActor;
let stranger: TestActor;
let treeId: string;

beforeAll(async () => {
	t = await createTestDatabase();
	owner = await createTestUser(t.db, 'owner');
	viewer = await createTestUser(t.db, 'viewer');
	stranger = await createTestUser(t.db, 'stranger');
	treeId = await createTestTree(t.db, owner);
	await addTestMember(t.db, treeId, viewer, 'viewer');
}, 60_000);
afterAll(async () => {
	await t.dispose();
});

function statusEvent(jobId: string, actor: TestActor | null): RequestEvent {
	const url = `http://epoch.test/api/import/${jobId}`;
	return {
		request: new Request(url),
		url: new URL(url),
		params: { jobId },
		locals: actor
			? { user: actor.context.user, correlationId: actor.context.correlationId }
			: { user: null, correlationId: 'anonymous' },
		platform: { env: { DB: t.d1 } }
	} as unknown as RequestEvent;
}

async function newJob(): Promise<string> {
	const jobId = crypto.randomUUID();
	await new ImportJobService(t.db).create({
		id: jobId,
		treeId,
		r2ObjectKey: `staging/gedcom-${treeId}-1.ged`,
		createdBy: owner.userId
	});
	return jobId;
}

describe('GET /api/import/[jobId]', () => {
	it('answers a pending job to its tree owner', async () => {
		const response = await GET(statusEvent(await newJob(), owner));
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ status: 'pending' });
	});

	it('answers the counts of a completed job, and the message of a failed one', async () => {
		const jobs = new ImportJobService(t.db);
		const counts = {
			individualsCount: 2,
			familiesCount: 1,
			eventsCount: 0,
			mergedFamiliesCount: 0
		};
		const done = await newJob();
		await jobs.complete(done, counts);
		expect(await (await GET(statusEvent(done, viewer))).json()).toEqual({
			status: 'complete',
			result: counts
		});

		const failed = await newJob();
		await jobs.fail(failed, 'The import failed. Please try again.');
		expect(await (await GET(statusEvent(failed, owner))).json()).toEqual({
			status: 'failed',
			error: 'The import failed. Please try again.'
		});
	});

	it('answers 404 to a user of another tree, the same as for an unknown job', async () => {
		const jobId = await newJob();
		const other = await GET(statusEvent(jobId, stranger));
		const unknown = await GET(statusEvent(crypto.randomUUID(), owner));
		expect(other.status).toBe(404);
		expect(unknown.status).toBe(404);
		expect(await other.json()).toEqual(await unknown.json());
	});

	it('refuses the signed out', async () => {
		const response = await GET(statusEvent(await newJob(), null));
		expect(response.status).toBe(401);
	});
});

describe('POST /api/import for a large file', () => {
	const PAD = 'X'.repeat(3 * 1024 * 1024);
	const GEDCOM = `0 HEAD\n1 GEDC\n2 VERS 5.5.1\n0 @I1@ INDI\n1 NAME Ada /Lovelace/\n1 NOTE ${PAD}\n0 TRLR\n`;

	function post(actor: TestActor, env: Record<string, unknown>): Promise<Response> {
		const body = new FormData();
		body.set('file', new File([GEDCOM], 'big.ged'));
		body.set('treeId', treeId);
		body.set('mode', 'merge');
		return POST({
			request: new Request('http://epoch.test/api/import', { method: 'POST', body }),
			locals: { user: actor.context.user, correlationId: actor.context.correlationId },
			platform: { env: { DB: t.d1, ...env } }
		} as unknown as RequestEvent) as Promise<Response>;
	}

	function bindings() {
		const staged = new Map<string, string>();
		const created: { id: string }[] = [];
		return {
			staged,
			created,
			env: {
				MEDIA_BUCKET: {
					put: async (key: string, value: string) => void staged.set(key, value),
					list: async () => ({ objects: [], truncated: false }),
					delete: async (key: string) => void staged.delete(key)
				},
				GEDCOM_IMPORT_WORKFLOW: {
					create: async (options: { id: string }) => void created.push(options)
				}
			}
		};
	}

	it('answers 202 with the job id, the instance id, and a pollable pending job', async () => {
		const b = bindings();
		const response = await post(owner, b.env);
		expect(response.status).toBe(202);
		const body = (await response.json()) as { status: string; treeId: string; jobId: string };
		expect(body).toEqual({ status: 'queued', treeId, jobId: body.jobId });
		expect(b.created.map((c) => c.id)).toEqual([body.jobId]);
		expect(b.staged.size).toBe(1);

		const polled = await GET(statusEvent(body.jobId, owner));
		expect(await polled.json()).toEqual({ status: 'pending' });
	}, 60_000);

	it('refuses a viewer before staging or creating anything', async () => {
		const b = bindings();
		const response = await post(viewer, b.env);
		expect(response.status).toBe(403);
		expect(b.staged.size).toBe(0);
		expect(b.created).toEqual([]);
	}, 60_000);
});
