import { WorkflowEntrypoint, type WorkflowStep, type WorkflowEvent } from 'cloudflare:workers';
import { getDb } from '../db';
import { assertSchemaCurrent } from '../db/schema-status';
import { buildGedcomString } from '../gedcom/serializer';
import type { GedcomFormat } from '../gedcom/tags';
import { GedcomService } from '../services/gedcom-service';

interface GedcomExportPayload {
	treeId: string;
	userId?: string;
	format?: GedcomFormat;
}

export class GedcomExportWorkflow extends WorkflowEntrypoint<
	App.Platform['env'],
	GedcomExportPayload
> {
	async run(event: WorkflowEvent<GedcomExportPayload>, step: WorkflowStep) {
		const format = event.payload.format ?? 'gedcom551';
		const { treeId, userId } = event.payload;
		const gedcom = new GedcomService(getDb(this.env.DB), { bucket: this.env.MEDIA_BUCKET });

		// The request was authorised when it was made; the job checks again, because it runs later and
		// a role may have changed, and because a job with no requester must not export at all (ADR-015).
		await step.do('authorize', () => gedcom.requireExporter(treeId, userId));

		const data = await step.do('fetch-records', async () => {
			await assertSchemaCurrent(this.env.DB);
			return gedcom.loadExport(treeId);
		});

		const gedcomContent = await step.do('serialize-gedcom', async () => {
			return buildGedcomString(data, format);
		});

		const fileKey = await step.do('write-r2-export', () =>
			gedcom.storeExport(treeId, data.treeName, gedcomContent)
		);

		return { status: 'complete', fileKey, format };
	}
}
