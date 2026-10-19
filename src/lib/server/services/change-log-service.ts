/**
 * Undo, and reading the change log (ADR-007).
 *
 * Undo applies the stored inverse of a chosen change (ADR-068), and only while nothing has moved
 * on since: another change to the same records, or records that no longer look the way the change
 * left them, both refuse it with a message saying so.
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
import { isManagerOrAbove } from '../../shared/roles';
import type { AuthenticatedContext } from '../domain/identity';
import { makeLabeler } from '../domain/tree-labels';
import {
	AUDIT_PAGE_SIZE,
	canUndoChange,
	type AuditFilters,
	type AuditPageDto
} from '../../shared/change-audit';
import { GraphWindowRepository } from '../repositories/graph-window-repository';
import { loadRowsForUndo } from '../domain/undo-scope';
import { ScopedRowLoader } from '../repositories/scoped-row-loader';
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

const DAY_MS = 24 * 60 * 60 * 1000;

function nothingToUndo() {
	return new UndoRefusedError(
		'There is nothing of yours to undo.',
		UNDO_REFUSALS.NOTHING_TO_UNDO,
		404
	);
}

export class ChangeLogService {
	private runner: MutationRunner;
	private scopedLoader: ScopedRowLoader;

	constructor(
		private db: DbClient,
		clock?: MutationClock
	) {
		this.runner = new MutationRunner(db, clock);
		this.scopedLoader = new ScopedRowLoader(db);
	}

	/** What the next undo would revert, or null. Lets the UI say what "Undo" will do. */
	async peekUndo(treeId: string, context: AuthenticatedContext) {
		await this.runner.requireAccess(treeId, context, 'tree:view');
		const target = await this.runner.store.latestUndoable(treeId, context.user.id);
		return target ? { id: target.id, summary: target.summary } : null;
	}

	/** Undo the signed-in user's newest change that can still be undone. */
	async undoLast(treeId: string, context: AuthenticatedContext): Promise<UndoResult> {
		await this.runner.requireAccess(treeId, context, 'tree:view');
		const target = await this.runner.store.latestUndoable(treeId, context.user.id);
		if (!target) throw nothingToUndo();
		return this.undoChange(treeId, target.id, context);
	}

	/** Undo one change by id, whoever made it and however long ago, if the rules in ADR-068 allow. */
	async undoChange(
		treeId: string,
		changeId: string,
		context: AuthenticatedContext
	): Promise<UndoResult> {
		const scope = await this.runner.scopeFor(treeId, context, 'tree:view');
		const { store } = this.runner;

		const target = await store.getById(treeId, changeId);
		if (!target) throw nothingToUndo();
		if (target.revertsChangeId !== null || !target.inverse) {
			throw new UndoRefusedError(
				`Can't undo "${target.summary}": ${target.revertsChangeId ? 'an undo is final, make the change again instead' : 'it was not recorded in a way that can be reversed'}.`,
				UNDO_REFUSALS.NOT_UNDOABLE
			);
		}
		if (target.actorId !== context.user.id && !isManagerOrAbove(scope.role)) {
			throw new UndoRefusedError(
				"Only a manager or owner can undo someone else's change.",
				UNDO_REFUSALS.NOT_YOURS,
				403
			);
		}
		if (await store.undoRowOf(target.id)) {
			throw new UndoRefusedError(
				`"${target.summary}" was already undone.`,
				UNDO_REFUSALS.ALREADY_UNDONE
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

		const current = await store.currentImages(target.inverse, treeId);
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

		// Only the records the undo writes and what points at them, not the tree (ADR-055).
		const rows = await loadRowsForUndo(rebased.ops, (seed) => this.scopedLoader.load(treeId, seed));
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

	/**
	 * One page of the audit log, newest first, filtered by record, actor and an inclusive range of
	 * UTC days (ADR-068). Needs `record:edit` for the reason `listRecent` does.
	 */
	async audit(
		treeId: string,
		context: AuthenticatedContext,
		options: Partial<AuditFilters> & { page?: number } = {}
	): Promise<AuditPageDto> {
		const scope = await this.runner.scopeFor(treeId, context, 'record:edit');
		const { store } = this.runner;
		const page = await store.auditPage(treeId, {
			page: options.page ?? 1,
			limit: AUDIT_PAGE_SIZE,
			recordId: options.recordId,
			actorId: options.actorId,
			since: options.from ? Date.parse(`${options.from}T00:00:00Z`) : null,
			// Exclusive end: the start of the day after `to`, so the whole of `to` is included.
			until: options.to ? Date.parse(`${options.to}T00:00:00Z`) + DAY_MS : null
		});
		const logActors = await store.actorIdsInLog(treeId);
		const repo = new GraphWindowRepository(this.db);
		const names = await repo.actorNames(treeId, [
			...logActors,
			...page.rows.flatMap((r) => (r.undoneActorId ? [r.undoneActorId] : []))
		]);
		const existing = await store.existingRecordIds(
			treeId,
			page.rows.flatMap((r) => r.changes.map((c) => c.entityId))
		);
		const viewer = { role: scope.role, userId: scope.userId };
		return {
			page: page.page,
			pageCount: page.pageCount,
			total: page.total,
			actors: logActors
				.map((id) => ({ id, name: names.get(id) ?? 'Someone' }))
				.sort((a, b) => a.name.localeCompare(b.name)),
			entries: page.rows.map((r) => ({
				id: r.id,
				seq: r.seq,
				kind: r.kind,
				summary: r.summary,
				actorName: names.get(r.actorId) ?? null,
				createdAt: r.createdAt,
				isUndo: r.isUndo,
				isUndone: r.isUndone,
				undoneByName: r.undoneActorId ? (names.get(r.undoneActorId) ?? null) : null,
				undoneAt: r.undoneAt,
				canUndo: canUndoChange(viewer, r),
				records: r.changes.map((c) => ({
					...c,
					isLinkable:
						(c.entityType === 'person' || c.entityType === 'union') && existing.has(c.entityId)
				}))
			}))
		};
	}
}
