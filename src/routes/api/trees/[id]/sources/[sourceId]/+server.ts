import { expectedVersion, treeHandler } from '#lib/server/http/handler.js';
import { EvidenceReadService } from '#lib/server/services/evidence-read-service.js';
import { EvidenceService } from '#lib/server/services/evidence-service.js';
import { parseListParams } from '#lib/shared/lists.js';
import { sourceUpdateSchema } from '#lib/server/validation/schemas.js';

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
 * the request says to remove the citations too (`?removeCitations=true`).
 */
export const DELETE = treeHandler(
	{ failure: 'Failed to delete the source', params: ['sourceId'] },
	async ({ db, ctx, treeId, params, url }) => {
		const { change } = await new EvidenceService(db).deleteSource(
			treeId,
			params.sourceId,
			{
				expectedVersion: expectedVersion(url),
				shouldRemoveCitations: url.searchParams.get('removeCitations') === 'true'
			},
			ctx
		);
		return { change };
	}
);
