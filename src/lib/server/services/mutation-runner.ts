/**
 * The one path every tree mutation takes: load the tree, plan row operations, check the caller may
 * make them, and commit them with their log entry atomically. Services build commands; this runs
 * them, so no mutation can skip the log or the permission check.
 */

import type { DbClient } from '../db';
import { isActionAllowed, type TreeAction } from '../auth/authorization';
import { TreeRepository } from '../repositories/tree-repository';
import { UserRepository } from '../repositories/user-repository';
import { requireTreeScope, type ViewerScope } from './tree-access';
import { ChangeStore, type CommittedChange } from '../repositories/change-store';
import {
	OP_KINDS,
	describeOps,
	opKind,
	withoutNoOps,
	type RecordChange,
	type RowOp,
	type TreeRows
} from '../domain/change-log';
import { UnauthorizedError } from '../domain/errors';
import { describeImpact, type ImpactSummary } from '../domain/impact';
import type { AuthenticatedContext } from '../domain/identity';
import type { RelationshipCommand } from '../domain/relationship-commands';
import { makeLabeler } from '../domain/tree-labels';
import { buildPlanOps } from '../domain/tree-ops';

export interface MutationClock {
	now: () => number;
	newId: () => string;
}

const SYSTEM_CLOCK: MutationClock = { now: () => Date.now(), newId: () => crypto.randomUUID() };

/** What a mutation returns to its caller, and through it to the toast. */
export interface MutationResult {
	/** Null when the request changed nothing. */
	change: CommittedChange | null;
	/** Every record written, for the caller's own preview-versus-result checks. */
	affected: RecordChange[];
}

/** The strongest action a set of ops needs: deleting outranks editing outranks creating. */
export function actionForOps(ops: RowOp[]): TreeAction {
	const kinds = new Set(withoutNoOps(ops).map(opKind));
	if (kinds.has(OP_KINDS.DELETE)) return 'record:delete';
	if (kinds.has(OP_KINDS.UPDATE)) return 'record:edit';
	return 'record:create';
}

export class MutationRunner {
	readonly store: ChangeStore;
	private userRepo: UserRepository;
	private treeRepo: TreeRepository;

	constructor(
		db: DbClient,
		readonly clock: MutationClock = SYSTEM_CLOCK
	) {
		this.store = new ChangeStore(db);
		this.userRepo = new UserRepository(db);
		this.treeRepo = new TreeRepository(db);
	}

	async requireAccess(treeId: string, context: AuthenticatedContext, action: TreeAction): Promise<void> {
		const membership = await this.userRepo.getMembership(treeId, context.user.id);
		if (!membership || !isActionAllowed(membership.role, action)) {
			throw new UnauthorizedError(`Forbidden: insufficient privileges for action '${action}'`);
		}
	}

	/** The action check plus what the caller may see of private people (ADR-015). */
	scopeFor(treeId: string, context: AuthenticatedContext, action: TreeAction): Promise<ViewerScope> {
		return requireTreeScope(this.userRepo, this.treeRepo, treeId, context, action, new Date(this.clock.now()));
	}

	plan(treeId: string, rows: TreeRows, commands: RelationshipCommand[]): RowOp[] {
		return buildPlanOps(rows, commands, { treeId, now: this.clock.now(), newId: this.clock.newId });
	}

	/** Read-only: what these commands would write, described. Nothing is saved. */
	async preview(treeId: string, context: AuthenticatedContext, commands: RelationshipCommand[], headline: string): Promise<ImpactSummary> {
		await this.requireAccess(treeId, context, 'tree:view');
		const rows = await this.store.loadRows(treeId);
		return describeImpact(headline, rows, this.plan(treeId, rows, commands));
	}

	/**
	 * Plan, authorise and commit. `rows` may be passed by a caller that already loaded and planned
	 * against it, so its preview and the write share one snapshot.
	 */
	async run(
		treeId: string,
		context: AuthenticatedContext,
		change: { kind: string; summary: (rows: TreeRows) => string; commands: RelationshipCommand[] },
		rows?: TreeRows
	): Promise<MutationResult> {
		await this.requireAccess(treeId, context, 'tree:view');
		const snapshot = rows ?? (await this.store.loadRows(treeId));
		const ops = this.plan(treeId, snapshot, change.commands);
		await this.requireAccess(treeId, context, actionForOps(ops));
		const affected = describeOps(ops, makeLabeler(snapshot, ops));
		const committed = await this.store.commit({
			treeId,
			actorId: context.user.id,
			kind: change.kind,
			summary: change.summary(snapshot),
			ops,
			changes: affected,
			isUndoable: true,
			correlationId: context.correlationId
		});
		return { change: committed, affected: committed ? affected : [] };
	}
}
