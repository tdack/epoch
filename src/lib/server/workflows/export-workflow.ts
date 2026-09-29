import { WorkflowEntrypoint, type WorkflowStep, type WorkflowEvent } from 'cloudflare:workers';
import { assertSchemaCurrent } from '../db/schema-status';
import { getTreeExportData } from '../gedcom/importer';
import { buildGedcomString, type GedcomFormat } from '../gedcom/index';

export interface GedcomExportPayload {
  treeId: string;
  userId?: string;
  format?: GedcomFormat;
}

export class GedcomExportWorkflow extends WorkflowEntrypoint<App.Platform['env'], GedcomExportPayload> {
  async run(event: WorkflowEvent<GedcomExportPayload>, step: WorkflowStep) {
    const format = event.payload.format ?? 'gedcom551';

    const data = await step.do('fetch-records', async () => {
      await assertSchemaCurrent(this.env.DB);
      // Query D1 DB for all Individuals, Families, and Events tied to treeId
      return await getTreeExportData(this.env.DB, event.payload.treeId);
    });

    const gedcomContent = await step.do('serialize-gedcom', async () => {
      return buildGedcomString(data, format);
    });

    const fileKey = await step.do('write-r2-export', async () => {
      const key = `exports/${event.payload.treeId}-${Date.now()}.ged`;
      await this.env.MEDIA_BUCKET.put(key, gedcomContent, {
        httpMetadata: {
          contentType: 'text/vnd.familysearch.gedcom',
          contentDisposition: `attachment; filename="${event.payload.treeId}.ged"`
        }
      });
      return key;
    });

    return { status: 'complete', fileKey, format };
  }
}
