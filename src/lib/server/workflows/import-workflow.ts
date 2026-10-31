import type { WorkflowStep, WorkflowEvent } from 'cloudflare:workers';
import { getDb } from '../db';
import { assertSchemaCurrent } from '../db/schema-status';
import { NotFoundError, PayloadTooLargeError, UnauthorizedError } from '../domain/errors';
import {
	GedcomService,
	isStagingKeyOf,
	type ImportCounts,
	type ImportQueueMessage
} from '../services/gedcom-service';
import { ImportJobService } from '../services/import-job-service';
import { NonRetryableError, WorkflowEntrypoint } from './workflow-runtime';

/** The payload is what the request staged; the instance id is the job id. */
export type GedcomImportPayload = ImportQueueMessage;

/** What a client is told when a job fails for a reason it can act on. Fixed text, never an error's own. */
const FAILURE_MESSAGES = {
	unauthorized: 'You no longer have permission to import into this tree.',
	missingTree: 'The tree no longer exists.',
	tooLarge: 'The file is too large to import.',
	missingFile: 'The uploaded file is no longer available. Upload it again.',
	generic: 'The import failed. Please try again.'
} as const;

/** A step failure becomes a client-safe sentence: no stack, no path, no message from the runtime. */
function safeFailure(err: unknown): string {
	if (err instanceof UnauthorizedError) return FAILURE_MESSAGES.unauthorized;
	if (err instanceof NotFoundError) return FAILURE_MESSAGES.missingTree;
	if (err instanceof PayloadTooLargeError) return FAILURE_MESSAGES.tooLarge;
	// A refusal crosses the step boundary as a plain `Error` whose class is not guaranteed, so it is
	// recognised by its message, which is one of the fixed sentences above and nothing else.
	const known: string[] = Object.values(FAILURE_MESSAGES);
	if (err instanceof Error && known.includes(err.message)) return err.message;
	return FAILURE_MESSAGES.generic;
}

/** Refusals that fail the same way on every attempt: retrying would only repeat them. */
function asNonRetryable(err: unknown): unknown {
	if (err instanceof UnauthorizedError || err instanceof NotFoundError) {
		return new NonRetryableError(safeFailure(err));
	}
	if (err instanceof PayloadTooLargeError) return new NonRetryableError(FAILURE_MESSAGES.tooLarge);
	return err;
}

/**
 * A large GEDCOM import (ADR-074, Phase 1). One step runs the import, because a step's result is
 * serialized (counts survive that, a parsed dataset would not) and the authorization check, the
 * read of the staged text and the write then see one unchanging tree. The job row is the client's
 * view of the run; the staged object is removed whichever way it ends.
 */
export class GedcomImportWorkflow extends WorkflowEntrypoint<
	App.Platform['env'],
	GedcomImportPayload
> {
	async run(event: WorkflowEvent<GedcomImportPayload>, step: WorkflowStep): Promise<ImportCounts> {
		const jobId = event.instanceId;
		const message = event.payload;
		const jobs = new ImportJobService(getDb(this.env.DB));

		try {
			await step.do('start-job', async () => {
				await jobs.start(jobId);
			});

			// One retry beyond the first attempt, as for export: a dataset that runs the isolate out of
			// memory would only do so again.
			const counts = await step.do('import-dataset', { retries: { limit: 2 } }, async () => {
				// A re-run of this step after it wrote (a lost response, a restarted instance) must not
				// import again: the staged text is gone and the job says it finished.
				const done = await jobs.completedCounts(jobId);
				if (done) return done;

				const gedcom = new GedcomService(getDb(this.env.DB), { bucket: this.env.MEDIA_BUCKET });
				await assertSchemaCurrent(this.env.DB);
				try {
					// Re-checks the tree and that the requester still holds `tree:import`, before any read.
					const written = await gedcom.importStagedCounted(message);
					if (!written) throw new NonRetryableError(FAILURE_MESSAGES.missingFile);
					return written;
				} catch (err) {
					console.error(`Import job ${jobId} failed:`, err);
					throw asNonRetryable(err);
				}
			});

			await step.do('complete-job', async () => {
				await jobs.complete(jobId, counts);
			});
			return counts;
		} catch (err) {
			await step.do('fail-job', async () => {
				await jobs.fail(jobId, safeFailure(err));
			});
			throw err;
		} finally {
			// `importStagedCounted` deletes on success and on a refusal; this covers every other end.
			await step.do('discard-staged', async () => {
				if (!isStagingKeyOf(message.treeId, message.r2ObjectKey)) return;
				try {
					await this.env.MEDIA_BUCKET.delete(message.r2ObjectKey);
				} catch (err) {
					// The `staging/` lifecycle rule is the backstop; the job's outcome is already recorded.
					console.error(`Could not delete ${message.r2ObjectKey}:`, err);
				}
			});
		}
	}
}
