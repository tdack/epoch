import { BindingUnavailableError } from '#lib/server/domain/errors.js';
import { apiHandler } from '#lib/server/http/handler.js';
import { enforceRateLimit } from '#lib/server/http/rate-limit.js';
import { GedzipImportService } from '#lib/server/services/gedzip-import-service.js';

/**
 * What importing a finished `gedzip_import` upload would do, read from the archive's directory and
 * dataset only. Same access as the start route, and the same rate budget: it parses the dataset.
 */
export const GET = apiHandler(
	{ failure: 'Failed to preview the import', params: ['id'] },
	async ({ db, ctx, event, params }) => {
		const env = event.platform?.env;
		if (!env?.MEDIA_BUCKET) throw new BindingUnavailableError('MEDIA_BUCKET');
		await enforceRateLimit({
			binding: env.IMPORT_RATE_LIMIT,
			bindingName: 'IMPORT_RATE_LIMIT',
			key: ctx.user.id,
			message: 'Too many imports; try again in a minute'
		});
		return new GedzipImportService(db, { bucket: env.MEDIA_BUCKET }).preview(params.id!, ctx);
	}
);
