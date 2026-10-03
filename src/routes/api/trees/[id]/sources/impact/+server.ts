import { treeHandler } from '#lib/server/http/handler.js';
import { EvidenceService } from '#lib/server/services/evidence-service.js';
import { evidenceImpactSchema } from '#lib/server/validation/schemas.js';

/** Preview a deletion or merge of sources, repositories or citations: which records it would change. Saves nothing. */
export const POST = treeHandler(
	{ failure: 'Failed to preview the change', body: evidenceImpactSchema },
	async ({ db, ctx, treeId, body }) => {
		const command =
			body.kind === 'delete_source'
				? {
						kind: 'delete_source' as const,
						sourceId: body.sourceId,
						expectedVersion: body.version,
						shouldRemoveCitations: body.shouldRemoveCitations
					}
				: body.kind === 'merge_sources'
					? {
							kind: 'merge_sources' as const,
							survivorId: body.survivorId,
							mergedIds: body.mergedIds
						}
					: body.kind === 'remove_citation'
						? {
								kind: 'remove_citation' as const,
								citationId: body.citationId,
								expectedVersion: body.version
							}
						: {
								kind: 'delete_repository' as const,
								repositoryId: body.repositoryId,
								expectedVersion: body.version
							};
		return { impact: await new EvidenceService(db).preview(treeId, command, ctx) };
	}
);
