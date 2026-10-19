import { treeServerLoad } from '#lib/server/http/page-load.js';
import { EvidenceReadService } from '#lib/server/services/evidence-read-service.js';
import { MediaService } from '#lib/server/services/media-service.js';
import { parseFileListQuery } from '#lib/server/validation/file-query.js';
import { parseListParams } from '#lib/shared/lists.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = treeServerLoad(
	{ failure: 'Failed to load the source', allowPublicVisitor: true },
	async ({ db, ctx, treeId }, { params, url, parent }) => {
		const { summary } = await parent();
		// The public visitor and a reader outside the tree get no Files list (the server refuses it), so
		// the page leaves the section out for them rather than showing an empty one.
		const hasFiles = !summary.viewer.isPublicVisitor && !summary.viewer.isOutsider;
		const [source, files] = await Promise.all([
			new EvidenceReadService(db).getSource(
				treeId,
				params.sourceId,
				parseListParams(url.searchParams),
				ctx
			),
			// A listing, not part of the source: the same visibility rule decides each file (ADR-061).
			hasFiles
				? new MediaService(db).list(
						ctx,
						parseFileListQuery(
							new URLSearchParams({ treeId, entityId: params.sourceId, limit: '100' })
						)
					)
				: null
		]);
		return { source, files: files?.files ?? null };
	}
);
