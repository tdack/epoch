import type { R2Bucket } from '@cloudflare/workers-types';
import type { WorkflowEvent, WorkflowStep } from 'cloudflare:workers';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { EXPECTED_MIGRATIONS } from '../db/schema-status';
import {
	addTestMember,
	createTestDatabase,
	createTestTree,
	createTestUser,
	type TestDatabase
} from '../testing/d1';
import { buildExportInstanceId } from './export-instance';
import { GedcomExportWorkflow, type GedcomExportPayload } from './export-workflow';

// The runtime is absent under Vitest: `WorkflowEntrypoint` is not in its `cloudflare:workers` shim
// and `cloudflare:workflows` does not resolve at all. The wrapper is mocked so the step logic runs
// against a fake base class and error.
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

let t: TestDatabase;
beforeAll(async () => {
	t = await createTestDatabase();
	// The harness applies migration SQL directly, so Wrangler's bookkeeping is seeded by hand for
	// the workflow's schema check.
	await t.d1
		.prepare(
			'CREATE TABLE IF NOT EXISTS d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL)'
		)
		.run();
	for (const name of EXPECTED_MIGRATIONS) {
		await t.d1.prepare('INSERT OR IGNORE INTO d1_migrations (name) VALUES (?)').bind(name).run();
	}
});
afterAll(async () => {
	await t.dispose();
});

/** An R2 stand-in for the workflow's single write. */
function fakeBucket() {
	const objects = new Set<string>();
	return {
		objects,
		bucket: {
			put: async (key: string) => {
				objects.add(key);
			}
		} as unknown as R2Bucket
	};
}

async function setup(role?: 'viewer' | 'editor') {
	const owner = await createTestUser(t.db);
	const treeId = await createTestTree(t.db, owner);
	const member = await createTestUser(t.db);
	if (role) await addTestMember(t.db, treeId, member, role);
	return { owner, member, treeId };
}

/** A step that runs its callback once and records the step names and configs it was asked for. */
function recordingStep(names: string[], configs: unknown[] = []): WorkflowStep {
	return {
		do: async (name: string, configOrCallback: unknown, maybeCallback?: () => unknown) => {
			names.push(name);
			const isConfigured = typeof configOrCallback !== 'function';
			configs.push(isConfigured ? configOrCallback : undefined);
			const callback = isConfigured ? maybeCallback : configOrCallback;
			return (callback as () => unknown)();
		}
	} as unknown as WorkflowStep;
}

function workflowWith(bucket: R2Bucket): GedcomExportWorkflow {
	return new GedcomExportWorkflow(
		{} as ExecutionContext,
		{
			DB: t.d1,
			MEDIA_BUCKET: bucket
		} as App.Platform['env']
	);
}

function eventFor(
	instanceId: string,
	payload: GedcomExportPayload
): WorkflowEvent<GedcomExportPayload> {
	return { instanceId, payload } as WorkflowEvent<GedcomExportPayload>;
}

describe('GedcomExportWorkflow', () => {
	it('builds the export as one step and answers only the key, format and packaging', async () => {
		const s = await setup();
		const { objects, bucket } = fakeBucket();
		const clientUuid = crypto.randomUUID();
		const instanceId = buildExportInstanceId(s.treeId, 'gedcom7', false, clientUuid);
		const names: string[] = [];
		const configs: unknown[] = [];

		const result = await workflowWith(bucket).run(
			eventFor(instanceId, {
				treeId: s.treeId,
				userId: s.owner.userId,
				format: 'gedcom7',
				shouldCompress: false
			}),
			recordingStep(names, configs)
		);

		expect(names).toEqual(['build-export']);
		// The step retries once, not Cloudflare's default handful: a build that OOMs would only OOM again.
		expect(configs).toEqual([{ retries: { limit: 1 } }]);
		expect(result).toEqual({
			fileKey: `exports/${s.treeId}-g7-${clientUuid}.ged`,
			format: 'gedcom7',
			shouldCompress: false
		});
		expect(objects.has(result.fileKey)).toBe(true);
	});

	it('fails without retrying, and writes nothing, a requester who may not export', async () => {
		const s = await setup('editor');
		const { objects, bucket } = fakeBucket();
		const instanceId = buildExportInstanceId(s.treeId, 'gedcom7', false, crypto.randomUUID());

		const error = (await workflowWith(bucket)
			.run(
				eventFor(instanceId, {
					treeId: s.treeId,
					userId: s.member.userId,
					format: 'gedcom7',
					shouldCompress: false
				}),
				recordingStep([])
			)
			.catch((e: unknown) => e)) as Error;

		expect(error.name).toBe('NonRetryableError');
		expect(error.message).toBe('Not authorized to export');
		expect(objects.size).toBe(0);
	});

	it('fails without retrying an instance id it did not mint, before touching R2', async () => {
		const s = await setup();
		const { objects, bucket } = fakeBucket();

		const error = (await workflowWith(bucket)
			.run(
				eventFor('a-cloudflare-made-id', { treeId: s.treeId, userId: s.owner.userId }),
				recordingStep([])
			)
			.catch((e: unknown) => e)) as Error;

		expect(error.name).toBe('NonRetryableError');
		expect(objects.size).toBe(0);
	});

	it('fails without retrying an instance id minted for another tree, before touching R2', async () => {
		const s = await setup();
		const { objects, bucket } = fakeBucket();
		const instanceId = buildExportInstanceId(
			crypto.randomUUID(),
			'gedcom7',
			false,
			crypto.randomUUID()
		);

		const error = (await workflowWith(bucket)
			.run(
				eventFor(instanceId, {
					treeId: s.treeId,
					userId: s.owner.userId,
					format: 'gedcom7',
					shouldCompress: false
				}),
				recordingStep([])
			)
			.catch((e: unknown) => e)) as Error;

		expect(error.name).toBe('NonRetryableError');
		expect(error.message).toBe('Export instance id does not match its payload');
		expect(objects.size).toBe(0);
	});
});
