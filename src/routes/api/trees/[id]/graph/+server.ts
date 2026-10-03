import { ValidationError } from '#lib/server/domain/errors.js';
import { treeHandler } from '#lib/server/http/handler.js';
import { GraphQueryService } from '#lib/server/services/graph-query-service.js';
import { parseFocusQuery } from '#lib/server/validation/graph-query.js';

/**
 * `?focus=<person>` answers the bounded graph the focus view draws (see `FocusGraphDto`); `up`,
 * `down`, `siblings`, `step` and `exp` shape it as they shape the page.
 */
export const GET = treeHandler(
	{ failure: 'Failed to load relationship graph' },
	({ db, ctx, treeId, url }) => {
		const { focusPersonId, options } = parseFocusQuery(url.searchParams);
		if (!focusPersonId) throw new ValidationError('focus: a person to centre the graph on');
		return new GraphQueryService(db).focusGraph(treeId, focusPersonId, options, ctx);
	}
);
