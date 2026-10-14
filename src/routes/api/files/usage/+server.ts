import { apiHandler } from '#lib/server/http/handler.js';
import { MediaService } from '#lib/server/services/media-service.js';
import { fileTreeQuerySchema } from '#lib/server/validation/schemas.js';

/**
 * How much media storage the caller can see: per tree for editors and above, and the install total
 * for the install owner. Read from R2, the same figure the upload quota is enforced against.
 */
export const GET = apiHandler(
	{ failure: 'Failed to read media storage use', query: fileTreeQuerySchema },
	({ db, ctx, event, query }) => {
		const bucket = event.platform?.env?.MEDIA_BUCKET;
		if (!bucket) return Response.json({ error: 'R2 binding unavailable' }, { status: 500 });
		return new MediaService(db).usage(ctx, bucket, query.treeId);
	}
);
