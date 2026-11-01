/// <reference types="@cloudflare/workers-types" />
import type { MessageBatch } from '@cloudflare/workers-types';
import sveltekitWorker from '../.svelte-kit/cloudflare/_worker.js';
import importConsumer from '../src/lib/server/workers/import-consumer';
import type { ImportQueueMessage } from '../src/lib/server/services/gedcom-service';
import { UploadService } from '../src/lib/server/services/upload-service';
import { getDb } from '../src/lib/server/db';
import {
	CHECKSUM_FILL_BATCH_BYTES,
	CHECKSUM_FILL_BATCH_SIZE,
	fillMissingChecksums
} from '../src/lib/server/media/fill-checksums';

// Re-export Workflows and Durable Objects so Wrangler can resolve their class_name
export { GedcomExportWorkflow } from '../src/lib/server/workflows/export-workflow';
export { GedcomImportWorkflow } from '../src/lib/server/workflows/import-workflow';
export { PlaceMatchWorkflow } from '../src/lib/server/workflows/place-match-workflow';

interface Env {
	DB: D1Database;
	MEDIA_BUCKET: R2Bucket;
	GEDCOM_IMPORT_QUEUE: Queue<ImportQueueMessage>;
	GEDCOM_EXPORT_WORKFLOW: Workflow;
	GEDCOM_IMPORT_WORKFLOW: Workflow;
	PLACE_MATCH_WORKFLOW: Workflow;
}

export default {
	fetch: sveltekitWorker.fetch.bind(sveltekitWorker),

	async queue(batch: MessageBatch<ImportQueueMessage>, env: Env): Promise<void> {
		await importConsumer.queue(batch, env as unknown as App.Platform['env']);
	},

	/**
	 * Closes upload sessions that were opened and never completed. One bounded batch per tick: a
	 * backlog drains over successive ticks, so no single run can exceed its subrequest or CPU budget.
	 */
	async scheduled(_controller: ScheduledController, env: Env): Promise<void> {
		const db = getDb(env.DB);
		const result = await new UploadService(db, env.MEDIA_BUCKET).sweepExpired();
		if (result.closed > 0) console.log(`Swept ${result.closed} expired upload sessions`);
		if (result.abortFailed > 0)
			console.error(`${result.abortFailed} expired upload sessions could not be aborted in R2`);
		// After the sweep and isolated from it: a failing checksum pass must not hide the sweep's result.
		try {
			const sums = await fillMissingChecksums(db, env.MEDIA_BUCKET, {
				limit: CHECKSUM_FILL_BATCH_SIZE,
				maxBytes: CHECKSUM_FILL_BATCH_BYTES
			});
			if (sums.filled > 0 || sums.skipped > 0)
				console.log(`Checksummed ${sums.filled} media files, skipped ${sums.skipped}`);
		} catch (err) {
			console.error('Media checksum fill failed:', err);
		}
	}
};
