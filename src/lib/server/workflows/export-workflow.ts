import { WorkflowEntrypoint, type WorkflowStep, type WorkflowEvent } from 'cloudflare:workers';
import { getDb } from '../db';
import { assertSchemaCurrent } from '../db/schema-status';
import { UnauthorizedError } from '../domain/errors';
import { UserRepository } from '../repositories/user-repository';
import { requireMemberAction } from '../services/tree-access';
import { getTreeExportData } from '../gedcom/importer';
import { buildGedcomString } from '../gedcom/serializer';
import { type GedcomFormat } from '../gedcom/tags';

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

		// The request was authorised when it was made; the job checks again, because it runs later and
		// a role may have changed, and because a job with no requester must not export at all (ADR-015).
		await step.do('authorize', async () => {
			const { treeId, userId } = event.payload;
			if (!userId)
				throw new UnauthorizedError("Forbidden: insufficient privileges for action 'tree:export'");
			await requireMemberAction(
				new UserRepository(getDb(this.env.DB)),
				treeId,
				userId,
				'tree:export'
			);
		});

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
