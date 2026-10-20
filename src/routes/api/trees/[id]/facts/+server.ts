import type { GroupFactResponse } from '#lib/shared/api-contracts.js';
import { treeHandler } from '#lib/server/http/handler.js';
import { FactService } from '#lib/server/services/fact-service.js';
import { citationAttachSchema, groupFactCreateSchema } from '#lib/server/validation/schemas.js';

/** Copy one fact onto several people in one change, so one Undo removes every copy. */
export const POST = treeHandler(
	{
		failure: 'Failed to add the fact',
		body: groupFactCreateSchema.extend({ citation: citationAttachSchema.optional() }),
		status: 201
	},
	async ({
		db,
		ctx,
		treeId,
		body: { personIds, citation, ...fact }
	}): Promise<GroupFactResponse> => {
		const { factIds, change } = await new FactService(db).createMany(
			treeId,
			personIds,
			fact,
			ctx,
			citation
		);
		return { factIds, change };
	}
);
