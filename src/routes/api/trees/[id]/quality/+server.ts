import { treeHandler } from '#lib/server/http/handler.js';
import { QualityService } from '#lib/server/services/quality-service.js';
import { qualityDismissSchema } from '#lib/server/validation/schemas.js';
import { ValidationError } from '#lib/server/domain/errors.js';

/** The data-quality report: findings over what the caller may see, and the ones dismissed with a reason. */
export const GET = treeHandler({ failure: 'Failed to load the report' }, ({ db, ctx, treeId }) =>
	new QualityService(db).report(treeId, ctx)
);

/** Dismiss one finding or several with a reason, all or none; dismissing again replaces the reason. */
export const PUT = treeHandler(
	{ failure: 'Failed to dismiss the findings', body: qualityDismissSchema },
	async ({ db, ctx, treeId, body: { key, keys, reason } }) => {
		await new QualityService(db).dismiss(treeId, keys ?? [key!], reason, ctx);
		return { ok: true };
	}
);

/** Bring a dismissed finding back: `?key=`. */
export const DELETE = treeHandler(
	{ failure: 'Failed to restore the finding' },
	async ({ db, ctx, treeId, url }) => {
		const key = url.searchParams.get('key');
		if (!key) throw new ValidationError('A finding key is required');
		await new QualityService(db).restore(treeId, key, ctx);
		return { ok: true };
	}
);
