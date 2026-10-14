import { treeHandler } from '#lib/server/http/handler.js';
import { EvidenceReadService } from '#lib/server/services/evidence-read-service.js';
import { parseListParams } from '#lib/shared/lists.js';

/** One page of sources, by title: `?q=&offset=&limit=`. `q` matches the title, author or abbreviation. */
export const GET = treeHandler(
	{ allowPublicVisitor: true, failure: 'Failed to list sources' },
	({ db, ctx, treeId, url }) =>
		new EvidenceReadService(db).listSources(
			treeId,
			{ ...parseListParams(url.searchParams), q: url.searchParams.get('q') ?? '' },
			ctx
		)
);
