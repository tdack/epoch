import { BindingUnavailableError } from '#lib/server/domain/errors.js';
import { apiHandler } from '#lib/server/http/handler.js';
import { enforceRateLimit } from '#lib/server/http/rate-limit.js';
import { GedzipImportService } from '#lib/server/services/gedzip-import-service.js';
import { gedzipImportSchema } from '#lib/server/validation/schemas.js';

/**
 * Starts the import Workflow for a finished `gedzip_import` upload. The archive's key is the
 * session's own, so the client names only the session. The client then polls `/api/import/<jobId>`.
 */
export const POST = apiHandler(
	{ failure: 'Failed to start the import', params: ['id'], body: gedzipImportSchema, status: 202 },
	async ({ db, ctx, event, params, body }) => {
		const env = event.platform?.env;
		if (!env?.MEDIA_BUCKET) throw new BindingUnavailableError('MEDIA_BUCKET');
		if (!env.GEDCOM_IMPORT_WORKFLOW) throw new BindingUnavailableError('GEDCOM_IMPORT_WORKFLOW');
		await enforceRateLimit({
			binding: env.IMPORT_RATE_LIMIT,
			bindingName: 'IMPORT_RATE_LIMIT',
			key: ctx.user.id,
			message: 'Too many imports; try again in a minute'
		});
		return new GedzipImportService(db, {
			bucket: env.MEDIA_BUCKET,
			importWorkflow: env.GEDCOM_IMPORT_WORKFLOW
		}).start(params.id!, body, ctx);
	}
);
