/// <reference types="@cloudflare/workers-types" />
import type { MessageBatch } from '@cloudflare/workers-types';
import sveltekitWorker from '../.svelte-kit/cloudflare/_worker.js';
import importConsumer, { type ImportQueueMessage } from '../src/lib/server/workers/import-consumer';

// Re-export Workflows and Durable Objects so Wrangler can resolve their class_name
export { GedcomExportWorkflow } from '../src/lib/server/workflows/export-workflow';

interface Env {
	DB: D1Database;
	MEDIA_BUCKET: R2Bucket;
	GEDCOM_IMPORT_QUEUE: Queue<ImportQueueMessage>;
	GEDCOM_EXPORT_WORKFLOW: Workflow;
}

export default {
	fetch: sveltekitWorker.fetch.bind(sveltekitWorker),

	async queue(batch: MessageBatch<ImportQueueMessage>, env: Env): Promise<void> {
		await importConsumer.queue(batch, env as unknown as App.Platform['env']);
	}
};
