/**
 * Undo, and reading the change log (ADR-007).
 *
 * Undo applies the stored inverse of the requesting user's most recent undoable change, and only
 * while nothing has moved on since: another change to the same records, or records that no longer
 * look the way the change left them, both refuse it with a message saying so.
 */

import type { DbClient } from '../db';
import { describeOps, rebaseInverse, recordsOf, UNDO_REFUSALS } from '../domain/change-log';
import { UndoRefusedError } from '../domain/errors';
import type { AuthenticatedContext } from '../domain/identity';
import { makeLabeler } from '../domain/tree-labels';
import { actionForOps, MutationRunner, type MutationClock, type MutationResult } from './mutation-runner';

export interface UndoResult extends MutationResult {
	/** The change that was reverted. */
	undone: { id: string; summary: string };
}

export class ChangeLogService {
	private runner: MutationRunner;

	constructor(db: DbClient, clock?: MutationClock) {
		this.runner = new MutationRunner(db, clock);
	}

	/** What the next undo would revert, or null. Lets the UI say what "Undo" will do. */
	async peekUndo(treeId: string, context: AuthenticatedContext) {
		await this.runner.requireAccess(treeId, context, 'tree:view');
		const target = await this.runner.store.latestUndoable(treeId, context.user.id);
		return target ? { id: target.id, summary: target.summary } : null;
	}

	async undoLast(treeId: string, context: AuthenticatedContext): Promise<UndoResult> {
		await this.runner.requireAccess(treeId, context, 'tree:view');
		const { store } = this.runner;

		const target = await store.latestUndoable(treeId, context.user.id);
		if (!target?.inverse) {
			throw new UndoRefusedError('There is nothing of yours to undo.', UNDO_REFUSALS.NOTHING_TO_UNDO, 404);
		}

		const later = await store.firstTouchedAfter(treeId, target.seq, recordsOf(target.inverse));
		if (later) {
			throw new UndoRefusedError(
				`Can't undo "${target.summary}" because a later change ("${later.summary}") also changed those records.`,
				UNDO_REFUSALS.TOUCHED_LATER
			);
		}

		const current = await store.currentImages(target.inverse);
		const rebased = rebaseInverse(target.inverse, (table, id) => current.get(`${table}:${id}`) ?? null, this.runner.clock.now());
		if (!rebased.isOk) {
			throw new UndoRefusedError(
				`Can't undo "${target.summary}" because the records it changed have been changed since.`,
				UNDO_REFUSALS.STATE_CHANGED
			);
		}

		// Undoing is itself an edit of the tree, so the caller needs the rights the ops require.
		await this.runner.requireAccess(treeId, context, actionForOps(rebased.ops));

		const rows = await store.loadRows(treeId);
		const affected = describeOps(rebased.ops, makeLabeler(rows, rebased.ops));
		const committed = await store.commit({
			treeId,
			actorId: context.user.id,
			kind: 'undo',
			summary: `Undid: ${target.summary}`,
			ops: rebased.ops,
			changes: affected,
			// There is no redo in Phase 2: an undo is final, and the person can simply make the change again.
			isUndoable: false,
			revertsChangeId: target.id,
			correlationId: context.correlationId
		});
		return { change: committed, affected, undone: { id: target.id, summary: target.summary } };
	}

	async listRecent(treeId: string, context: AuthenticatedContext, limit = 50) {
		await this.runner.requireAccess(treeId, context, 'tree:view');
		return this.runner.store.listRecent(treeId, limit);
	}
}
