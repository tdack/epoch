import type { R2Bucket } from '@cloudflare/workers-types';
import { eq } from 'drizzle-orm';
import type { WorkflowEvent, WorkflowStep } from 'cloudflare:workers';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { EXPECTED_MIGRATIONS } from '../db/schema-status';
import { individuals, mediaItems } from '../db/schema';
import { crc32 } from '../gedcom/crc32';
import { FakeMediaBucket } from '../testing/fake-bucket';
import { ImportJobService } from './import-job-service';
import { MAX_TREE_MEDIA_BYTES } from '../../shared/media';
import {
	addTestMember,
	createTestDatabase,
	createTestTree,
	createTestUser,
	type TestDatabase
} from '../testing/d1';
import { GedcomImportWorkflow, type GedcomImportPayload } from '../workflows/import-workflow';
import { UploadRepository } from '../repositories/upload-repository';
import { GedzipImportService } from './gedzip-import-service';

// The runtime is absent under Vitest; see export-workflow.test.ts.
vi.mock('../workflows/workflow-runtime', () => ({
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

// @ts-expect-error @types/node is not installed; the fixture is binary, so it is read here.
const { existsSync, readFileSync } = await import('node:fs');
const archiveUrl = new URL('../gedcom/fixtures/conformance/files/maximal70.gdz', import.meta.url);

/** A bucket that serves the ranged reads and `head` the zip reader makes. */
class RangeBucket extends FakeMediaBucket {
	async head(key: string) {
		const object = this.objects.get(key);
		return object ? { key, size: object.body.byteLength } : null;
	}
	async get(key: string, options?: { range?: { offset: number; length: number } }) {
		const object = this.objects.get(key);
		if (!object) return null;
		const range = options?.range;
		const bytes = range
			? object.body.slice(range.offset, range.offset + range.length)
			: object.body;
		return {
			key,
			size: object.size,
			httpEtag: '"etag"',
			httpMetadata: { contentType: object.contentType },
			body: new ReadableStream<Uint8Array>({
				start(controller) {
					controller.enqueue(bytes);
					controller.close();
				}
			}),
			arrayBuffer: async () => bytes.slice().buffer
		};
	}
}

let t: TestDatabase;
beforeAll(async () => {
	t = await createTestDatabase();
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

function recordingStep(names: string[]): WorkflowStep {
	return {
		do: async (name: string, configOrCallback: unknown, maybeCallback?: () => unknown) => {
			names.push(name);
			const callback = typeof configOrCallback === 'function' ? configOrCallback : maybeCallback;
			return (callback as () => unknown)();
		}
	} as unknown as WorkflowStep;
}

async function setup(role: 'owner' | 'editor' | 'viewer' = 'editor') {
	const owner = await createTestUser(t.db);
	const treeId = await createTestTree(t.db, owner);
	const requester = await createTestUser(t.db);
	if (role !== 'owner') await addTestMember(t.db, treeId, requester, role);
	const bucket = new RangeBucket();
	const key = `staging/uploads/${treeId}/${crypto.randomUUID()}`;
	await bucket.put(key, new Uint8Array(readFileSync(archiveUrl)));
	const jobId = crypto.randomUUID();
	const jobs = new ImportJobService(t.db);
	await jobs.create({ id: jobId, treeId, r2ObjectKey: key, createdBy: requester.userId });
	const message: GedcomImportPayload = {
		treeId,
		r2ObjectKey: key,
		mode: 'replace',
		actorId: requester.userId,
		isArchive: true
	};
	const env = { DB: t.d1, MEDIA_BUCKET: bucket as unknown as R2Bucket } as App.Platform['env'];
	const run = (names: string[] = []) =>
		new GedcomImportWorkflow({} as ExecutionContext, env).run(
			{ instanceId: jobId, payload: message } as WorkflowEvent<GedcomImportPayload>,
			recordingStep(names)
		);
	const service = new GedzipImportService(t.db, { bucket: bucket as unknown as R2Bucket });
	const files = () => t.db.select().from(mediaItems).where(eq(mediaItems.treeId, treeId));
	return { owner, treeId, key, jobId, jobs, bucket, message, run, service, files };
}

describe.skipIf(!existsSync(archiveUrl))('importing maximal70.gdz', () => {
	it('stores the media, adds the unnamed entries, and records the counts', async () => {
		const s = await setup();
		const names: string[] = [];
		const counts = await s.run(names);

		expect(names).toEqual([
			'start-job',
			'import-dataset',
			'import-media-0',
			'close-archive',
			'complete-job',
			'discard-staged'
		]);
		expect(counts.media).toEqual({
			resolved: 2,
			unresolved: 3,
			detachedAdded: 2,
			skippedByType: 1,
			overCap: 0,
			overQuota: 0,
			unreadable: 0
		});
		expect(s.bucket.objects.has(s.key)).toBe(false);
		expect(await s.jobs.status(s.jobId, s.owner.context)).toMatchObject({
			status: 'complete',
			result: { media: counts.media }
		});

		const rows = await s.files();
		const jpg = rows.find(
			(r) => r.gedcomPath === 'media/CharlotteBrontë.jpg'.replace('ë', '%C3%AB')
		)!;
		expect(jpg.status).toBeNull();
		expect(jpg.mimeType).toBe('image/jpeg');
		expect(jpg.sizeBytes).toBe(79000);
		expect(jpg.r2ObjectKey).toBe(`media/${s.treeId}/${jpg.id}.jpg`);
		const stored = s.bucket.objects.get(jpg.r2ObjectKey)!;
		expect(stored.body.byteLength).toBe(79000);
		expect(jpg.crc32).toBe(crc32(stored.body));
		expect(jpg.sha256).toBeNull();

		const mp3 = rows.find((r) => r.gedcomPath === 'media/original.mp3')!;
		expect(mp3).toMatchObject({ status: null, mimeType: 'audio/mpeg' });
		expect(mp3.r2ObjectKey.endsWith('.mp3')).toBe(true);

		// `file:` and web FILEs stay unresolved, with their placeholder keys.
		const unresolved = rows.filter((r) => r.status === 'unresolved');
		expect(unresolved).toHaveLength(3);
		expect(unresolved.every((r) => r.r2ObjectKey.startsWith('unresolved/'))).toBe(true);

		const detached = rows.filter((r) => r.gedcomPath?.startsWith('media/') && r.uploadedBy);
		expect(detached.map((r) => r.gedcomPath).sort()).toEqual([
			'media/derived.oga',
			'media/transcript.vtt'
		]);
		expect(detached.every((r) => r.status === null && r.objectId === r.id)).toBe(true);
	});

	it('changes nothing when a media step runs again', async () => {
		const s = await setup();
		await s.run();
		const before = JSON.stringify(await s.files());
		const keys = [...s.bucket.objects.keys()].sort();
		// The archive is gone after the close step; put it back as a retried step would still see it.
		await s.bucket.put(s.key, new Uint8Array(readFileSync(archiveUrl)));

		const again = await s.service.importMediaBatch(s.message, 0);

		expect(again.next).toBeNull();
		expect(again.counts).toMatchObject({ resolved: 0, detachedAdded: 0, overQuota: 0 });
		expect(JSON.stringify(await s.files())).toBe(before);
		expect([...s.bucket.objects.keys()].filter((k) => k !== s.key).sort()).toEqual(
			keys.filter((k) => k !== s.key)
		);
	});

	it('skips and counts entries when the tree has no room', async () => {
		const s = await setup();
		await s.bucket.put(`media/${s.treeId}/full`, new Uint8Array(1));
		s.bucket.objects.get(`media/${s.treeId}/full`)!.size = MAX_TREE_MEDIA_BYTES;

		const counts = await s.run();

		expect(counts.media).toMatchObject({
			resolved: 0,
			detachedAdded: 0,
			overQuota: 4,
			unresolved: 5
		});
		expect((await s.files()).filter((r) => r.status === null)).toHaveLength(0);
	});

	it('writes nothing for a requester who no longer holds tree:import', async () => {
		const s = await setup('viewer');
		const error = (await s.run().catch((e: unknown) => e)) as Error;

		expect(error.name).toBe('NonRetryableError');
		expect(await s.files()).toEqual([]);
		expect(await t.db.select().from(individuals).where(eq(individuals.treeId, s.treeId))).toEqual(
			[]
		);
		expect(s.bucket.objects.has(s.key)).toBe(false);
	});

	it('refuses a key outside the tree’s upload area', async () => {
		const s = await setup();
		await expect(
			s.service.importDataset({ ...s.message, r2ObjectKey: `media/${s.treeId}/x.jpg` })
		).rejects.toMatchObject({ status: 403 });
	});

	it('starts a session once and refuses a second start', async () => {
		const owner = await createTestUser(t.db);
		const treeId = await createTestTree(t.db, owner);
		const bucket = new RangeBucket();
		const sent: string[] = [];
		const service = new GedzipImportService(t.db, {
			bucket: bucket as unknown as R2Bucket,
			importWorkflow: { create: async ({ id }) => void sent.push(id) }
		});
		const sessionId = crypto.randomUUID();
		await new UploadRepository(t.db).insert({
			id: sessionId,
			treeId,
			purpose: 'gedzip_import',
			r2Key: `staging/uploads/${treeId}/${sessionId}`,
			r2UploadId: 'u',
			partSizeBytes: 10,
			totalBytes: 10,
			createdBy: owner.userId,
			createdAt: new Date(),
			expiresAt: new Date(Date.now() + 60_000)
		});
		await new UploadRepository(t.db).closeOpen(sessionId, 'complete');
		const input = { mode: 'merge', shouldMergeDuplicateFamilies: false } as const;

		await expect(service.start(sessionId, input, owner.context)).resolves.toMatchObject({
			status: 'queued'
		});
		await expect(service.start(sessionId, input, owner.context)).rejects.toMatchObject({
			status: 409
		});
		expect(sent).toHaveLength(1);
	});
});
