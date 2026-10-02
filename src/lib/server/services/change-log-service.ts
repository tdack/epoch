/**
 * Undo, and reading the change log (ADR-007).
 *
 * Undo applies the stored inverse of the requesting user's most recent undoable change, and only
 * while nothing has moved on since: another change to the same records, or records that no longer
 * look the way the change left them, both refuse it with a message saying so.
 */

import type { DbClient } from '../db';
import {
	dependentsOfDeletions,
	describeOps,
	rebaseInverse,
	recordsOf,
	UNDO_REFUSALS
} from '../domain/change-log';
import { UndoRefusedError } from '../domain/errors';
import type { AuthenticatedContext } from '../domain/identity';
import { makeLabeler } from '../domain/tree-labels';
import {
	actionForOps,
	MutationRunner,
	type MutationClock,
	type MutationResult
} from './mutation-runner';

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
		const scope = await this.runner.scopeFor(treeId, context, 'tree:view');
		const { store } = this.runner;

		const target = await store.latestUndoable(treeId, context.user.id);
		if (!target?.inverse) {
			throw new UndoRefusedError(
				'There is nothing of yours to undo.',
				UNDO_REFUSALS.NOTHING_TO_UNDO,
				404
			);
		}

		const later = await store.firstTouchedAfter(treeId, target.seq, recordsOf(target.inverse));
		if (later) {
			throw new UndoRefusedError(
				// A later change may be someone else's, and its summary names whoever it touched.
				`Can't undo "${target.summary}" because a later change${scope.isRestricted ? '' : ` ("${later.summary}")`} also changed those records.`,
				UNDO_REFUSALS.TOUCHED_LATER
			);
		}

		const current = await store.currentImages(target.inverse);
		const rebased = rebaseInverse(
			target.inverse,
			(table, id) => current.get(`${table}:${id}`) ?? null,
			this.runner.clock.now()
		);
		if (!rebased.isOk) {
			throw new UndoRefusedError(
				`Can't undo "${target.summary}" because the records it changed have been changed since.`,
				UNDO_REFUSALS.STATE_CHANGED
			);
		}

		// Undoing is itself an edit of the tree, so the caller needs the rights the ops require.
		await this.runner.requireAccess(treeId, context, actionForOps(rebased.ops));

		const rows = await store.loadRows(treeId);
		const labeler = makeLabeler(rows, rebased.ops);

		// Deleting a row cascades to whatever points at it. If someone has since attached something
		// to it, undoing would silently delete their work, so refuse and say what is in the way.
		const [dependent] = dependentsOfDeletions(rows, rebased.ops);
		if (dependent) {
			throw new UndoRefusedError(
				`Can't undo "${target.summary}" because other records now depend on it${scope.isRestricted ? '' : ` (${labeler(dependent.table, dependent.row)})`}. Remove those first.`,
				UNDO_REFUSALS.HAS_DEPENDENTS
			);
		}

		const affected = describeOps(rebased.ops, labeler);
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
		// The tree-wide log is prose naming whoever a change touched, so only roles that see everyone read it.
		await this.runner.requireAccess(treeId, context, 'record:edit');
		return this.runner.store.listRecent(treeId, limit);
	}
}
