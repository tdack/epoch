import { apiHandler } from '#lib/server/http/handler.js';
import type { R2Object, WorkflowInstance } from '@cloudflare/workers-types';
import {
	ExportExpiredError,
	ExportUnavailableError,
	NotFoundError
} from '#lib/server/domain/errors.js';
import { deleteExport } from '#lib/server/http/export-storage.js';
import { GedcomService } from '#lib/server/services/gedcom-service.js';
import {
	EXPORT_CODES,
	EXPORT_STATES,
	exportObjectKey,
	exportWriteTime,
	isExportExpired,
	mapWorkflowStatus,
	type ExportState
} from '#lib/server/workflows/export-instance.js';

const options = { failure: 'Export failed' };

/**
 * An asynchronous export's progress, for the client to poll. It answers a closed `{ status, code }`
 * and nothing else: not the workflow's own error, not the object key. A tree the caller is not in,
 * or an id this application never minted, is the same 404 as an id that has gone.
 */
export const GET = apiHandler(
	{ ...options, params: ['instanceId'] },
	async ({ db, ctx, event, params }) => {
		const env = event.platform?.env;
		const bucket = env?.MEDIA_BUCKET;
		const workflow = env?.GEDCOM_EXPORT_WORKFLOW;
		if (!bucket || !workflow) throw new ExportUnavailableError();

		// Authorization first, before the workflow or R2 is touched: an id the caller may not read
		// never reaches the runtime.
		const parsed = await new GedcomService(db).requireExportInstance(params.instanceId, ctx);

		// Each runtime read is its own try: a missing instance and a broken call are told apart here,
		// and no catch is broad enough that a domain error would have to be re-thrown by hand.
		let instance: WorkflowInstance;
		try {
			instance = await workflow.get(params.instanceId);
		} catch {
			// The runtime no longer knows the instance: it has been purged. Its file, if the workflow
			// wrote one, is now an orphan, so clear it before answering the same 404.
			await deleteExport(bucket, parsed);
			throw new NotFoundError('Export');
		}

		let state: ExportState;
		try {
			state = mapWorkflowStatus((await instance.status()).status);
		} catch {
			throw new NotFoundError('Export');
		}

		if (state === EXPORT_STATES.complete) {
			const fileKey = exportObjectKey(parsed.treeId, parsed.token, parsed.clientUuid);
			let object: R2Object | null;
			try {
				object = await bucket.head(fileKey);
			} catch {
				throw new ExportUnavailableError();
			}
			if (!object) {
				state = EXPORT_STATES.errored;
			} else if (isExportExpired(exportWriteTime(object))) {
				await deleteExport(bucket, parsed, true);
				throw new ExportExpiredError();
			}
		}

		return { status: state, code: EXPORT_CODES[state] };
	}
);
