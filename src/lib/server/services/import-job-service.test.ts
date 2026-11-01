import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { importJobs } from '../db/schema';
import { NotFoundError } from '../domain/errors';
import { ImportJobRepository } from '../repositories/import-job-repository';
import {
	addTestMember,
	createTestDatabase,
	createTestTree,
	createTestUser,
	type TestDatabase
} from '../testing/d1';
import { GedcomService } from './gedcom-service';
import { ImportJobService } from './import-job-service';

const COUNTS = { individualsCount: 2, familiesCount: 1, eventsCount: 3, mergedFamiliesCount: 0 };

let t: TestDatabase;
beforeAll(async () => {
	t = await createTestDatabase();
});
afterAll(async () => {
	await t.dispose();
});

async function setup() {
	const owner = await createTestUser(t.db);
	const treeId = await createTestTree(t.db, owner);
	const jobId = crypto.randomUUID();
	await new ImportJobService(t.db).create({
		id: jobId,
		treeId,
		r2ObjectKey: `staging/gedcom-${treeId}-1.ged`,
		createdBy: owner.userId
	});
	return { owner, treeId, jobId };
}

describe('ImportJobRepository', () => {
	it('creates a pending job and finds it', async () => {
		const s = await setup();
		expect(await new ImportJobRepository(t.db).find(s.jobId)).toMatchObject({
			id: s.jobId,
			treeId: s.treeId,
			status: 'pending',
			result: null,
			error: null,
			createdBy: s.owner.userId
		});
		expect(await new ImportJobRepository(t.db).find(crypto.randomUUID())).toBeNull();
	});

	it('does not reopen a finished job or fail a completed one', async () => {
		const s = await setup();
		const repo = new ImportJobRepository(t.db);
		await repo.complete(s.jobId, JSON.stringify(COUNTS));
		await repo.markRunning(s.jobId);
		await repo.fail(s.jobId, 'late');
		const row = await t.db.select().from(importJobs).where(eq(importJobs.id, s.jobId)).get();
		expect(row).toMatchObject({ status: 'complete', error: null, result: JSON.stringify(COUNTS) });
	});
});

describe('ImportJobService', () => {
	it('moves pending to running to complete and reports the counts', async () => {
		const s = await setup();
		const service = new ImportJobService(t.db);
		expect(await service.status(s.jobId, s.owner.context)).toEqual({ status: 'pending' });
		await service.start(s.jobId);
		expect(await service.status(s.jobId, s.owner.context)).toEqual({ status: 'running' });
		expect(await service.completedCounts(s.jobId)).toBeNull();
		await service.complete(s.jobId, COUNTS);
		expect(await service.status(s.jobId, s.owner.context)).toEqual({
			status: 'complete',
			result: COUNTS
		});
		expect(await service.completedCounts(s.jobId)).toEqual(COUNTS);
	});

	it('records a failure message', async () => {
		const s = await setup();
		const service = new ImportJobService(t.db);
		await service.fail(s.jobId, 'The import failed.');
		expect(await service.status(s.jobId, s.owner.context)).toEqual({
			status: 'failed',
			error: 'The import failed.'
		});
	});

	it('lets any member read it', async () => {
		const s = await setup();
		const viewer = await createTestUser(t.db);
		await addTestMember(t.db, s.treeId, viewer, 'viewer');
		expect(await new ImportJobService(t.db).status(s.jobId, viewer.context)).toEqual({
			status: 'pending'
		});
	});

	it('answers not found for a job in a tree the caller is not in, and for an unknown job', async () => {
		const s = await setup();
		const stranger = await createTestUser(t.db);
		const service = new ImportJobService(t.db);
		await expect(service.status(s.jobId, stranger.context)).rejects.toBeInstanceOf(NotFoundError);
		await expect(service.status(crypto.randomUUID(), s.owner.context)).rejects.toBeInstanceOf(
			NotFoundError
		);
	});
});

describe('a large import', () => {
	const FILE = '0 HEAD\n0 @I1@ INDI\n1 NAME Ann /Fox/\n0 TRLR';

	it('records a pending job under the id the workflow instance is created with', async () => {
		const s = await setup();
		const created: { id: string }[] = [];
		const staged = new Map<string, string>();
		const service = new GedcomService(t.db, {
			bucket: {
				put: async (key: string, value: string) => void staged.set(key, value),
				list: async () => ({ objects: [], truncated: false }),
				delete: async (key: string) => void staged.delete(key)
			} as never,
			importWorkflow: { create: async (options) => void created.push(options) }
		});
		const outcome = await service.importFile(
			{
				treeId: s.treeId,
				treeName: null,
				fileName: 'big.ged',
				text: FILE,
				sizeBytes: 3 * 1024 * 1024,
				mode: 'replace',
				shouldMergeDuplicateFamilies: false
			},
			s.owner.context
		);
		if (outcome.status !== 'queued') throw new Error('expected a queued import');
		expect(created.map((c) => c.id)).toEqual([outcome.jobId]);
		const row = await new ImportJobRepository(t.db).find(outcome.jobId);
		expect(row).toMatchObject({ status: 'pending', createdBy: s.owner.userId, treeId: s.treeId });
		expect(staged.has(row!.r2ObjectKey)).toBe(true);
	});

	it('fails the job and removes the staged text when the instance cannot be created', async () => {
		const s = await setup();
		const staged = new Map<string, string>();
		const service = new GedcomService(t.db, {
			bucket: {
				put: async (key: string, value: string) => void staged.set(key, value),
				list: async () => ({ objects: [], truncated: false }),
				delete: async (key: string) => void staged.delete(key)
			} as never,
			importWorkflow: {
				create: async () => {
					throw new Error('workflow down');
				}
			}
		});
		await expect(
			service.importFile(
				{
					treeId: s.treeId,
					treeName: null,
					fileName: 'big.ged',
					text: FILE,
					sizeBytes: 3 * 1024 * 1024,
					mode: 'replace',
					shouldMergeDuplicateFamilies: false
				},
				s.owner.context
			)
		).rejects.toThrow('workflow down');
		expect(staged.size).toBe(0);
		const failed = await t.db
			.select()
			.from(importJobs)
			.where(eq(importJobs.treeId, s.treeId))
			.all();
		expect(failed.filter((j) => j.id !== s.jobId)).toMatchObject([{ status: 'failed' }]);
	});
});
