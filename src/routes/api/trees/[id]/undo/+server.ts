import type { UndoResponse } from '#lib/shared/api-contracts.js';
import { treeHandler } from '#lib/server/http/handler.js';
import { undoSchema } from '#lib/server/validation/schemas.js';
import { ChangeLogService } from '#lib/server/services/change-log-service.js';

/** What "Undo" would revert next for the signed-in user, or null. */
export const GET = treeHandler(
	{ failure: 'Failed to look up undo' },
	async ({ db, ctx, treeId }) => ({
		next: await new ChangeLogService(db).peekUndo(treeId, ctx)
	})
);

/** Undo the change `changeId` names (ADR-068), or, without one, the signed-in user's latest undoable change. */
export const POST = treeHandler(
	{ failure: 'Failed to undo', body: undoSchema },
	async ({ db, ctx, treeId, body }): Promise<UndoResponse> => {
		const service = new ChangeLogService(db);
		const { undone, change } = body.changeId
			? await service.undoChange(treeId, body.changeId, ctx)
			: await service.undoLast(treeId, ctx);
		return { undone, change };
	}
);
