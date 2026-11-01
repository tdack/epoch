import type { WorkflowStep, WorkflowEvent } from 'cloudflare:workers';
import { getDb } from '../db';
import { assertSchemaCurrent } from '../db/schema-status';
import { UnauthorizedError } from '../domain/errors';
import { buildGedcomString } from '../gedcom/serializer';
import type { GedcomFormat } from '../gedcom/tags';
import { GdzExportService } from '../services/gdz-export-service';
import { GedcomService } from '../services/gedcom-service';
import { parseExportInstanceId } from './export-instance';
import { NonRetryableError, WorkflowEntrypoint } from './workflow-runtime';

export interface GedcomExportPayload {
	treeId: string;
	userId?: string;
	format?: GedcomFormat;
	/** Package as GEDZip. Optional, so an instance queued before it existed still runs. */
	shouldCompress?: boolean;
	/** Put the tree's media in the `.gdz`, written as segments. Optional, like `shouldCompress`. */
	shouldIncludeMedia?: boolean;
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
		const shouldIncludeMedia = event.payload.shouldIncludeMedia ?? false;
		const { treeId, userId } = event.payload;

		// The id carries the tree and the two export choices; the payload must agree with all three, or
		// the object key (from the id) could name another tree's file or an extension the bytes are not.
		const parsed = parseExportInstanceId(event.instanceId);
		if (!parsed) throw new NonRetryableError('Export instance id was not minted here');
		if (
			parsed.format !== format ||
			parsed.shouldCompress !== shouldCompress ||
			parsed.shouldIncludeMedia !== shouldIncludeMedia ||
			parsed.treeId !== treeId
		) {
			throw new NonRetryableError('Export instance id does not match its payload');
		}

		if (shouldIncludeMedia) return this.runSegmented(step, treeId, userId, parsed.clientUuid);

		// One retry, not Cloudflare's default handful: a huge build that runs out of memory would
		// only run out again, so a second attempt is enough to ride out a transient failure and a
		// third would just waste the instance's budget.
		return step.do('build-export', { retries: { limit: 1 } }, async () => {
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

	/**
	 * A `.gdz` with media: one step per segment, so no step holds more than a batch and a failed
	 * step retries alone. Each step returns only a byte length; the archive offset a segment starts
	 * at is the sum of the lengths before it, which the replayed results rebuild exactly.
	 */
	private async runSegmented(
		step: WorkflowStep,
		treeId: string,
		userId: string | undefined,
		clientUuid: string
	): Promise<GedcomExportResult> {
		const service = new GdzExportService(getDb(this.env.DB), this.env.MEDIA_BUCKET);
		const authorised = async <T>(work: () => Promise<T>): Promise<T> => {
			try {
				await assertSchemaCurrent(this.env.DB);
				return await work();
			} catch (err) {
				if (err instanceof UnauthorizedError)
					throw new NonRetryableError('Not authorized to export');
				throw err;
			}
		};

		const dataset = await step.do('dataset', { retries: { limit: 1 } }, () =>
			authorised(() => service.writeDataset(treeId, userId, clientUuid))
		);
		const lengths = [dataset.length];
		for (let i = 0; i < dataset.batchCount; i++) {
			const offset = lengths.reduce((sum, n) => sum + n, 0);
			const { length } = await step.do(`media-${i}`, { retries: { limit: 2 } }, () =>
				authorised(() => service.writeMediaBatch(treeId, userId, clientUuid, i, offset))
			);
			lengths.push(length);
		}
		const fileKey = await step.do('tail', { retries: { limit: 1 } }, () =>
			authorised(() => service.writeTail(treeId, userId, clientUuid, lengths))
		);
		return { fileKey, format: 'gedcom7', shouldCompress: true };
	}
}
