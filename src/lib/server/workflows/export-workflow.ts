import type { WorkflowStep, WorkflowEvent } from 'cloudflare:workers';
import { getDb } from '../db';
import { assertSchemaCurrent } from '../db/schema-status';
import { UnauthorizedError } from '../domain/errors';
import { buildGedcomString } from '../gedcom/serializer';
import type { GedcomFormat } from '../gedcom/tags';
import { GedcomService } from '../services/gedcom-service';
import { parseExportInstanceId } from './export-instance';
import { NonRetryableError, WorkflowEntrypoint } from './workflow-runtime';

export interface GedcomExportPayload {
	treeId: string;
	userId?: string;
	format?: GedcomFormat;
	/** Package as GEDZip. Optional, so an instance queued before it existed still runs. */
	shouldCompress?: boolean;
}

/** What a finished export hands back to the runtime: the object key and the choice, never bytes. */
export interface GedcomExportResult {
	fileKey: string;
	format: GedcomFormat;
	shouldCompress: boolean;
}

/**
 * A large export, built behind one workflow step. One step, because a step's result is serialized
 * (bytes cannot survive that, a key can), and because authorizing, reading the tree and writing the
 * object then happen against one unchanging tree.
 */
export class GedcomExportWorkflow extends WorkflowEntrypoint<
	App.Platform['env'],
	GedcomExportPayload
> {
	async run(
		event: WorkflowEvent<GedcomExportPayload>,
		step: WorkflowStep
	): Promise<GedcomExportResult> {
		// An instance queued before 7.0 became the default named no format and meant 5.5.1.
		const format = event.payload.format ?? 'gedcom551';
		const shouldCompress = event.payload.shouldCompress ?? false;
		const { treeId, userId } = event.payload;

		// The id carries the same two choices. They must agree, or the object's extension (from the id)
		// could describe a file the bytes are not.
		const parsed = parseExportInstanceId(event.instanceId);
		if (!parsed) throw new NonRetryableError('Export instance id was not minted here');
		if (parsed.format !== format || parsed.shouldCompress !== shouldCompress) {
			throw new NonRetryableError('Export instance id does not match its payload');
		}

		return step.do('build-export', async () => {
			const gedcom = new GedcomService(getDb(this.env.DB), { bucket: this.env.MEDIA_BUCKET });

			// The request was authorised when it was made; the job checks again, because it runs later
			// and a role may have changed, and because a job with no requester must not export at all
			// (ADR-015). A refusal fails the instance without retrying, before any R2 write.
			try {
				await gedcom.requireExporter(treeId, userId);
			} catch (err) {
				if (err instanceof UnauthorizedError)
					throw new NonRetryableError('Not authorized to export');
				throw err;
			}

			await assertSchemaCurrent(this.env.DB);
			const data = await gedcom.loadExport(treeId);
			const content = buildGedcomString(data, format);
			const fileKey = await gedcom.storeExport(
				treeId,
				data.treeName,
				content,
				parsed.token,
				parsed.clientUuid
			);
			return { fileKey, format, shouldCompress };
		});
	}
}
