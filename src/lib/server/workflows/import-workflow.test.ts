import type { R2Bucket } from '@cloudflare/workers-types';
import { eq } from 'drizzle-orm';
import type { WorkflowEvent, WorkflowStep } from 'cloudflare:workers';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { individuals } from '../db/schema';
import { ImportJobService } from '../services/import-job-service';
import {
	addTestMember,
	createTestDatabase,
	createTestTree,
	createTestUser,
	type TestDatabase
} from '../testing/d1';
import { GedcomImportWorkflow, type GedcomImportPayload } from './import-workflow';

// The runtime is absent under Vitest; see export-workflow.test.ts.
vi.mock('./workflow-runtime', () => ({
	WorkflowEntrypoint: class {
		env: unknown;
		constructor(_ctx: unknown, env: unknown) {
			this.env = env;
		}
	},
	NonRetryableError: class NonRetryableError extends Error {
		constructor(message: string) {
			super(message);
			this.name = 'NonRetryableError';
		}
	}
}));

const FILE = '0 HEAD\n0 @I1@ INDI\n1 NAME Ann /Fox/\n0 @I2@ INDI\n1 NAME Ben /Fox/\n0 TRLR';
const REPLACEMENT = '0 HEAD\n0 @I1@ INDI\n1 NAME Solo /Fox/\n0 TRLR';

let t: TestDatabase;
beforeAll(async () => {
	t = await createTestDatabase();
});
afterAll(async () => {
	await t.dispose();
});

function fakeBucket() {
	const objects = new Map<string, string>();
	const bucket = {
		put: async (key: string, value: string) => void objects.set(key, value),
		get: async (key: string) => {
			const found = objects.get(key);
			return found === undefined ? null : { size: found.length, text: async () => found };
		},
		delete: async (key: string) => void objects.delete(key)
	} as unknown as R2Bucket;
	return { objects, bucket };
}

/** Runs each step once, in order, recording names; `retries` mimics none. */
function recordingStep(names: string[]): WorkflowStep {
	return {
		do: async (name: string, configOrCallback: unknown, maybeCallback?: () => unknown) => {
			names.push(name);
			const callback = typeof configOrCallback === 'function' ? configOrCallback : maybeCallback;
			return (callback as () => unknown)();
		}
	} as unknown as WorkflowStep;
}

async function setup(role: 'owner' | 'editor' | 'viewer' | null = 'editor') {
	const owner = await createTestUser(t.db);
	const treeId = await createTestTree(t.db, owner);
	const requester = await createTestUser(t.db);
	if (role && role !== 'owner') await addTestMember(t.db, treeId, requester, role);
	const { objects, bucket } = fakeBucket();
	const key = `staging/gedcom-${treeId}-${crypto.randomUUID()}.ged`;
	await bucket.put(key, FILE);
	const jobId = crypto.randomUUID();
	const jobs = new ImportJobService(t.db);
	await jobs.create({ id: jobId, treeId, r2ObjectKey: key, createdBy: requester.userId });
	const payload: GedcomImportPayload = {
		treeId,
		r2ObjectKey: key,
		mode: 'replace',
		actorId: requester.userId
	};
	const run = (names: string[] = [], override: Partial<GedcomImportPayload> = {}) =>
		new GedcomImportWorkflow(
			{} as ExecutionContext,
			{
				DB: t.d1,
				MEDIA_BUCKET: bucket
			} as App.Platform['env']
		).run(
			{
				instanceId: jobId,
				payload: { ...payload, ...override }
			} as WorkflowEvent<GedcomImportPayload>,
			recordingStep(names)
		);
	const people = async () =>
		(await t.db.select().from(individuals).where(eq(individuals.treeId, treeId))).length;
	return { owner, requester, treeId, key, jobId, jobs, objects, bucket, run, people };
}

describe('GedcomImportWorkflow', () => {
	it('imports the staged text, completes the job with counts and deletes the object', async () => {
		const s = await setup();
		const names: string[] = [];
		const counts = await s.run(names);

		expect(names).toEqual(['start-job', 'import-dataset', 'complete-job', 'discard-staged']);
		expect(counts).toMatchObject({ individualsCount: 2 });
		expect(await s.people()).toBe(2);
		expect(await s.jobs.status(s.jobId, s.owner.context)).toEqual({
			status: 'complete',
			result: counts
		});
		expect(s.objects.size).toBe(0);
	});

	it('does not import twice when the dataset step runs again after the job completed', async () => {
		const s = await setup();
		await s.run();
		// A replace import re-run over later edits would wipe them; the second run must write nothing.
		await s.bucket.put(s.key, REPLACEMENT);
		const again = await s.run();
		expect(again).toMatchObject({ individualsCount: 2 });
		expect(await s.people()).toBe(2);
	});

	it('fails the job with a fixed message, writes nothing and deletes the object for a revoked requester', async () => {
		const s = await setup('viewer');
		const error = (await s.run().catch((e: unknown) => e)) as Error;

		expect(error.name).toBe('NonRetryableError');
		expect(await s.people()).toBe(0);
		expect(await s.jobs.status(s.jobId, s.owner.context)).toEqual({
			status: 'failed',
			error: 'You no longer have permission to import into this tree.'
		});
		expect(s.objects.size).toBe(0);
	});

	it('fails a job whose staged text has gone, without an internal path in the message', async () => {
		const s = await setup();
		await s.bucket.delete(s.key);
		await s.run().catch(() => undefined);

		const status = await s.jobs.status(s.jobId, s.owner.context);
		expect(status.status).toBe('failed');
		expect(status.error).toBe('The uploaded file is no longer available. Upload it again.');
		expect(status.error).not.toContain('staging/');
	});

	it('records a generic message, not the thrown text, for an unexpected failure', async () => {
		const s = await setup();
		// A payload that names no actor is refused; an unexpected throw is simulated by a bad R2 read.
		const bucket = {
			get: async () => {
				throw new Error('R2 exploded at /internal/path');
			},
			delete: async () => {}
		} as unknown as R2Bucket;
		const workflow = new GedcomImportWorkflow(
			{} as ExecutionContext,
			{
				DB: t.d1,
				MEDIA_BUCKET: bucket
			} as App.Platform['env']
		);
		await workflow
			.run(
				{
					instanceId: s.jobId,
					payload: { treeId: s.treeId, r2ObjectKey: s.key, actorId: s.requester.userId }
				} as WorkflowEvent<GedcomImportPayload>,
				recordingStep([])
			)
			.catch(() => undefined);

		const status = await s.jobs.status(s.jobId, s.owner.context);
		expect(status).toEqual({ status: 'failed', error: 'The import failed. Please try again.' });
	});
});
