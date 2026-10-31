import { and, eq, inArray } from 'drizzle-orm';
import type { DbClient } from '../db';
import { importJobs } from '../db/schema';

export type ImportJobStatus = 'pending' | 'running' | 'complete' | 'failed';

export interface ImportJobRow {
	id: string;
	treeId: string;
	r2ObjectKey: string;
	status: ImportJobStatus;
	/** JSON counts; null until the run completes. */
	result: string | null;
	error: string | null;
	createdBy: string | null;
}

export interface NewImportJob {
	id: string;
	treeId: string;
	r2ObjectKey: string;
	createdBy: string;
}

/** The `import_job` rows: one per large import, read back by the client that started it. */
export class ImportJobRepository {
	constructor(private db: DbClient) {}

	async create(job: NewImportJob): Promise<void> {
		await this.db.insert(importJobs).values({ ...job, status: 'pending' });
	}

	async find(id: string): Promise<ImportJobRow | null> {
		const row = await this.db.select().from(importJobs).where(eq(importJobs.id, id)).get();
		return row ?? null;
	}

	/**
	 * Only a job that has not ended moves to running: a retried start must not reopen a finished
	 * job, and a late write must not undo `failed`.
	 */
	async markRunning(id: string): Promise<void> {
		await this.db
			.update(importJobs)
			.set({ status: 'running', updatedAt: new Date() })
			.where(and(eq(importJobs.id, id), inArray(importJobs.status, ['pending', 'running'])));
	}

	async complete(id: string, resultJson: string): Promise<void> {
		await this.db
			.update(importJobs)
			.set({ status: 'complete', result: resultJson, error: null, updatedAt: new Date() })
			.where(eq(importJobs.id, id));
	}

	async fail(id: string, error: string): Promise<void> {
		await this.db
			.update(importJobs)
			.set({ status: 'failed', error, updatedAt: new Date() })
			// A job that completed stays complete: a failure recorded after the fact would lie.
			.where(and(eq(importJobs.id, id), inArray(importJobs.status, ['pending', 'running'])));
	}
}
