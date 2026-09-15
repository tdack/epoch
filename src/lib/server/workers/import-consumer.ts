import type { MessageBatch } from '@cloudflare/workers-types';
import { importGedcomToDb } from '../gedcom/importer';

export interface ImportQueueMessage {
  treeId: string;
  r2ObjectKey: string;
  treeName?: string;
  mode?: 'replace' | 'merge';
}

/**
 * Cloudflare Queue Consumer for asynchronous large GEDCOM processing.
 * Reads the raw .ged file from R2 staging, tokenizes, and batch inserts to D1.
 */
export default {
  async queue(batch: MessageBatch<ImportQueueMessage>, env: App.Platform['env']): Promise<void> {
    for (const msg of batch.messages) {
      try {
        const { treeId, r2ObjectKey, treeName, mode } = msg.body;
        const r2Object = await env.MEDIA_BUCKET.get(r2ObjectKey);

        if (!r2Object) {
          console.error(`Object not found in R2: ${r2ObjectKey}`);
          msg.ack();
          continue;
        }

        const rawGedcom = await r2Object.text();
        await importGedcomToDb(env.DB, treeId, rawGedcom, treeName, mode ?? 'replace');

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
