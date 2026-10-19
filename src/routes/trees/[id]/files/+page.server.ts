import { error } from '@sveltejs/kit';
import { BindingUnavailableError } from '#lib/server/domain/errors.js';
import { treeServerLoad } from '#lib/server/http/page-load.js';
import { MediaService } from '#lib/server/services/media-service.js';
import { parseFileListQuery } from '#lib/server/validation/file-query.js';
import type { PageServerLoad } from './$types';

/**
 * The files of the tree, to start with, and the storage the caller may see. The public visitor and
 * a reader with no membership of the tree are not offered the manager at all; the server would
 * refuse their list anyway, so the page is a 404 for them rather than an empty table.
 */
export const load: PageServerLoad = treeServerLoad(
	{ failure: 'Failed to list files', allowPublicVisitor: true },
	async ({ db, ctx, treeId }, { parent, platform }) => {
		const { summary } = await parent();
		if (summary.viewer.isPublicVisitor || summary.viewer.isOutsider) error(404, 'Not found');
		const bucket = platform?.env?.MEDIA_BUCKET;
		if (!bucket) throw new BindingUnavailableError('MEDIA_BUCKET');
		const media = new MediaService(db);
		const [files, usage] = await Promise.all([
			media.list(ctx, parseFileListQuery(new URLSearchParams({ treeId }))),
			media.usage(ctx, bucket)
		]);
		return { files, usage };
	}
);
