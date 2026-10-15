import type { UndoResponse } from '#lib/shared/api-contracts.js';
import { treeHandler } from '#lib/server/http/handler.js';
import { ChangeLogService } from '#lib/server/services/change-log-service.js';

/** What "Undo" would revert next for the signed-in user, or null. */
export const GET = treeHandler(
	{ failure: 'Failed to look up undo' },
	async ({ db, ctx, treeId }) => ({
		next: await new ChangeLogService(db).peekUndo(treeId, ctx)
	})
);

/** Undo the signed-in user's most recent undoable change in this tree. */
export const POST = treeHandler(
	{ failure: 'Failed to undo' },
	async ({ db, ctx, treeId }): Promise<UndoResponse> => {
		const { undone, change } = await new ChangeLogService(db).undoLast(treeId, ctx);
		return { undone, change };
	}
);
