import { treeHandler } from '#lib/server/http/handler.js';
import { EvidenceReadService } from '#lib/server/services/evidence-read-service.js';
import { parseListParams } from '#lib/shared/lists.js';

/** One page of repositories, by name: `?q=&offset=&limit=`. */
export const GET = treeHandler(
	{ allowPublicVisitor: true, failure: 'Failed to list repositories' },
	({ db, ctx, treeId, url }) =>
		new EvidenceReadService(db).listRepositories(
			treeId,
			{ ...parseListParams(url.searchParams), q: url.searchParams.get('q') ?? '' },
			ctx
		)
);
