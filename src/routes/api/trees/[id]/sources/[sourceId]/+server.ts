import { expectedVersion, treeHandler } from '#lib/server/http/handler.js';
import { EvidenceReadService } from '#lib/server/services/evidence-read-service.js';
import { EvidenceService } from '#lib/server/services/evidence-service.js';
import { parseListParams } from '#lib/shared/lists.js';
import { sourceDeleteQuerySchema, sourceUpdateSchema } from '#lib/server/validation/schemas.js';

/**
 * A source, its repositories and a page of the records that cite it (`?offset=&limit=`). A source
 * that supports nothing the viewer may see answers 404, as a private person does.
 */
export const GET = treeHandler(
	{ allowPublicVisitor: true, failure: 'Failed to load the source', params: ['sourceId'] },
	({ db, ctx, treeId, params, url }) =>
		new EvidenceReadService(db).getSource(
			treeId,
			params.sourceId,
			parseListParams(url.searchParams),
			ctx
		)
);

export const PUT = treeHandler(
	{ failure: 'Failed to save the source', params: ['sourceId'], body: sourceUpdateSchema },
	async ({ db, ctx, treeId, params, body: { version, ...source } }) => {
		const { change } = await new EvidenceService(db).updateSource(
			treeId,
			params.sourceId,
			source,
			version,
			ctx
		);
		return { change };
	}
);

/**
 * Delete a source. A cited source is refused with the citation count (409, `SOURCE_IN_USE`) unless
 * the request says to remove the citations too (`?removeCitations=true&citationCount=N`, the count
 * the caller was shown; a different count now is a 409 and nothing is deleted). A source cited
 * more than one change can write is deleted in steps: `remaining` is the citations still to go,
 * and the caller repeats the request with that as the count until it is 0.
 */
export const DELETE = treeHandler(
	{ failure: 'Failed to delete the source', params: ['sourceId'], query: sourceDeleteQuerySchema },
	async ({ db, ctx, treeId, params, url, query }) => {
		const { change, remaining = 0 } = await new EvidenceService(db).deleteSource(
			treeId,
			params.sourceId,
			{
				expectedVersion: expectedVersion(url),
				shouldRemoveCitations: query.removeCitations === 'true',
				expectedCitationCount: query.citationCount
			},
			ctx
		);
		return { change, remaining };
	}
);
