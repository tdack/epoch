import { WorkflowEntrypoint, type WorkflowStep, type WorkflowEvent } from 'cloudflare:workers';
import { getTreeExportData } from '../gedcom/importer';
import { buildGedcom551String } from '../gedcom/index';

export interface GedcomExportPayload {
  treeId: string;
  userId?: string;
}

export class GedcomExportWorkflow extends WorkflowEntrypoint<App.Platform['env'], GedcomExportPayload> {
  async run(event: WorkflowEvent<GedcomExportPayload>, step: WorkflowStep) {
    const data = await step.do('fetch-records', async () => {
      // Query D1 DB for all Individuals, Families, and Events tied to treeId
      return await getTreeExportData(this.env.DB, event.payload.treeId);
    });

    const gedcomContent = await step.do('serialize-gedcom', async () => {
      return buildGedcom551String(data);
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

    return { status: 'complete', fileKey };
  }
}
