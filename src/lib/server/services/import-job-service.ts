/**
 * The status record of a large import. The workflow writes it (it knows the requester's id and
 * nothing else); a client reads it through `status`, which answers 404 for a job in a tree the
 * caller is not a member of, so a probe cannot tell an unknown id from someone else's.
 */

import type { DbClient } from '../db';
import { NotFoundError } from '../domain/errors';
import type { AuthenticatedContext } from '../domain/identity';
import {
	ImportJobRepository,
	type ImportJobStatus,
	type NewImportJob
} from '../repositories/import-job-repository';
import { UserRepository } from '../repositories/user-repository';
import type { ImportCounts } from './gedcom-service';

/** What a client is told about a job: counts on success, a safe message on failure, nothing else. */
export interface ImportJobStatusDto {
	status: ImportJobStatus;
	/** Media entries handled so far of all in the archive; present while a `.gdz` import runs. */
	progress?: { done: number; total: number };
	result?: ImportCounts;
	error?: string;
}

export class ImportJobService {
	private jobs: ImportJobRepository;
	private users: UserRepository;

	constructor(db: DbClient) {
		this.jobs = new ImportJobRepository(db);
		this.users = new UserRepository(db);
	}

	create(job: NewImportJob): Promise<void> {
		return this.jobs.create(job);
	}

	start(id: string): Promise<void> {
		return this.jobs.markRunning(id);
	}

	progress(id: string, done: number, total: number): Promise<void> {
		return this.jobs.setProgress(id, JSON.stringify({ done, total }));
	}

	complete(id: string, counts: ImportCounts): Promise<void> {
		return this.jobs.complete(id, JSON.stringify(counts));
	}

	fail(id: string, error: string): Promise<void> {
		return this.jobs.fail(id, error);
	}

	/** The counts of a job that already finished, so a restarted workflow does not import twice. */
	async completedCounts(id: string): Promise<ImportCounts | null> {
		const job = await this.jobs.find(id);
		return job?.status === 'complete' && job.result
			? (JSON.parse(job.result) as ImportCounts)
			: null;
	}

	/** The job's state for a member of its tree; 404 for everyone else, whatever the reason. */
	async status(id: string, context: AuthenticatedContext): Promise<ImportJobStatusDto> {
		const job = await this.jobs.find(id);
		if (!job) throw new NotFoundError('Import');
		if (!(await this.users.getMembership(job.treeId, context.user.id))) {
			throw new NotFoundError('Import');
		}
		const stored = job.result ? (JSON.parse(job.result) as unknown) : null;
		return {
			status: job.status,
			...(stored && job.status === 'complete' ? { result: stored as ImportCounts } : {}),
			...(stored && job.status === 'running'
				? { progress: stored as { done: number; total: number } }
				: {}),
			...(job.error ? { error: job.error } : {})
		};
	}
}
