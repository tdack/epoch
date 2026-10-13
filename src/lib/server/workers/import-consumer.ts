import type { MessageBatch } from '@cloudflare/workers-types';
import { assertSchemaCurrent } from '../db/schema-status';
import { getDb } from '../db';
import { NotFoundError, PayloadTooLargeError, UnauthorizedError } from '../domain/errors';
import { GedcomService, type ImportQueueMessage } from '../services/gedcom-service';

/**
 * Cloudflare Queue Consumer for asynchronous large GEDCOM processing.
 * Reads the raw .ged file from R2 staging, tokenizes, and batch inserts to D1.
 */
export default {
	async queue(batch: MessageBatch<ImportQueueMessage>, env: App.Platform['env']): Promise<void> {
		// A queue message outlives a deploy, so check once up front and let every message retry
		// rather than acking imports that cannot be written.
		try {
			await assertSchemaCurrent(env.DB);
		} catch (err) {
			console.error(err);
			batch.retryAll();
			return;
		}

		for (const msg of batch.messages) {
			try {
				const service = new GedcomService(getDb(env.DB), { bucket: env.MEDIA_BUCKET });
				if (!(await service.importStaged(msg.body))) {
					console.error(`Object not found in R2: ${msg.body.r2ObjectKey}`);
				}

				msg.ack();
			} catch (err) {
				// Dropped, not retried: a revoked actor, or a staged file over the cap, fails the same way
				// on every delivery, and nothing was written, so there is nothing to recover.
				if (
					err instanceof UnauthorizedError ||
					err instanceof NotFoundError ||
					err instanceof PayloadTooLargeError
				) {
					const reason =
						err instanceof PayloadTooLargeError ? 'staged file too large' : 'no longer authorized';
					console.warn(
						`Dropped queued GEDCOM import for tree ${msg.body.treeId} by actor ${msg.body.actorId ?? 'none'}: ${reason}`
					);
					msg.ack();
					continue;
				}
				console.error('Failed to process GEDCOM import queue message:', err);
				msg.retry();
			}
		}
	}
};
