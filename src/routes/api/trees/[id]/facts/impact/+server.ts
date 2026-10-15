import type { ImpactResponse } from '#lib/shared/api-contracts.js';
import { treeHandler } from '#lib/server/http/handler.js';
import { FactService } from '#lib/server/services/fact-service.js';
import { factImpactSchema } from '#lib/server/validation/schemas.js';

/** Preview a fact change: exactly which records it would create, change or delete. Saves nothing. */
export const POST = treeHandler(
	{ failure: 'Failed to preview the fact change', body: factImpactSchema },
	async ({ db, ctx, treeId, body }): Promise<ImpactResponse> => {
		// A previewed create needs an id to plan against; it is discarded, and the save mints its own.
		const command =
			body.kind === 'create_fact'
				? {
						kind: 'create_fact' as const,
						personId: body.personId,
						factId: 'preview',
						fact: body.fact
					}
				: body.kind === 'update_fact'
					? {
							kind: 'update_fact' as const,
							factId: body.factId,
							expectedVersion: body.version,
							fact: body.fact
						}
					: { kind: 'delete_fact' as const, factId: body.factId, expectedVersion: body.version };
		return { impact: await new FactService(db).preview(treeId, command, ctx) };
	}
);
