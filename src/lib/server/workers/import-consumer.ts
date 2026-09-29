import type { MessageBatch } from '@cloudflare/workers-types';
import { assertSchemaCurrent } from '../db/schema-status';
import { importGedcomToDb } from '../gedcom/importer';

export interface ImportQueueMessage {
  treeId: string;
  r2ObjectKey: string;
  treeName?: string;
  mode?: 'replace' | 'merge';
  /** Carried through the queue so a large file is merged exactly as the preview promised. */
  shouldMergeDuplicateFamilies?: boolean;
}

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
        const { treeId, r2ObjectKey, treeName, mode, shouldMergeDuplicateFamilies } = msg.body;
        const r2Object = await env.MEDIA_BUCKET.get(r2ObjectKey);

        if (!r2Object) {
          console.error(`Object not found in R2: ${r2ObjectKey}`);
          msg.ack();
          continue;
        }

        const rawGedcom = await r2Object.text();
        await importGedcomToDb(env.DB, treeId, rawGedcom, treeName, mode ?? 'replace', { shouldMergeDuplicateFamilies });

        // Clean up temporary staging file in R2
        await env.MEDIA_BUCKET.delete(r2ObjectKey);

        msg.ack();
      } catch (err) {
        console.error('Failed to process GEDCOM import queue message:', err);
        msg.retry();
      }
    }
  }
};
