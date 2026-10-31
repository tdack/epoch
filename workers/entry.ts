/// <reference types="@cloudflare/workers-types" />
import type { MessageBatch } from '@cloudflare/workers-types';
import sveltekitWorker from '../.svelte-kit/cloudflare/_worker.js';
import importConsumer from '../src/lib/server/workers/import-consumer';
import type { ImportQueueMessage } from '../src/lib/server/services/gedcom-service';
import { UploadService } from '../src/lib/server/services/upload-service';
import { getDb } from '../src/lib/server/db';

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
		const result = await new UploadService(getDb(env.DB), env.MEDIA_BUCKET).sweepExpired();
		if (result.closed > 0) console.log(`Swept ${result.closed} expired upload sessions`);
		if (result.abortFailed > 0)
			console.error(`${result.abortFailed} expired upload sessions could not be aborted in R2`);
	}
};
