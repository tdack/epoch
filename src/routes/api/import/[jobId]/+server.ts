import type { ImportStatusResponse } from '#lib/shared/api-contracts.js';
import { apiHandler } from '#lib/server/http/handler.js';
import { ImportJobService } from '#lib/server/services/import-job-service.js';

/**
 * A large import's progress, for the import screen to poll. A job in a tree the caller is not in,
 * and an id that never existed, are the same 404; the answer carries counts or a fixed message,
 * never the workflow's own error.
 */
export const GET = apiHandler(
	{ failure: 'Failed to check the import', params: ['jobId'] },
	({ db, ctx, params }): Promise<ImportStatusResponse> =>
		new ImportJobService(db).status(params.jobId!, ctx)
);
