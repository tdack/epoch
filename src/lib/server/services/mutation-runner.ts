/**
 * The one path every tree mutation takes: load the tree, plan row operations, check the caller may
 * make them, and commit them with their log entry atomically. Services build commands; this runs
 * them, so no mutation can skip the log or the permission check.
 */

import type { DbClient } from '../db';
import type { TreeAction } from '../auth/authorization';
import { TreeRepository } from '../repositories/tree-repository';
import { UserRepository } from '../repositories/user-repository';
import {
	requireRealUser,
	requireTreeAction,
	requireTreeScope,
	type ViewerScope
} from './tree-access';
import { ChangeStore, type CommittedChange } from '../repositories/change-store';
import { ScopedRowLoader } from '../repositories/scoped-row-loader';
import { seedFor } from '../domain/write-scope/index';
import { seedWithFollowUp } from '../domain/write-scope/follow-up';
import type { ScopeSeed } from '../domain/write-scope';
import {
	OP_KINDS,
	describeOps,
	opKind,
	withoutNoOps,
	type RowOp,
	type TreeRows
} from '../domain/change-log';
import { type RecordChange } from '../../shared/impact';
import { UnauthorizedError } from '../domain/errors';
import { describeImpact } from '../domain/impact';
import { carriedCitations, carriedNotes } from '../domain/evidence-carry';
import { type ImpactSummary } from '../../shared/impact';
import type { AuthenticatedContext } from '../domain/identity';
import type { RelationshipCommand } from '../domain/relationship-commands';
import { makeLabeler } from '../domain/tree-labels';
import { buildPlanOps } from '../domain/tree-ops';
import { omitForScope, opsTouchPrivate } from '../domain/privacy-mask';

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

/**
 * What a preview shows: the impact of the ops over the rows the caller may see, with the evidence
 * and notes the commands would carry. Pure, so the scoped-snapshot equivalence tests (ADR-055) run
 * the same code the preview endpoint does.
 */
export function previewOf(
	visible: TreeRows,
	commands: RelationshipCommand[],
	ops: RowOp[],
	headline: (rows: TreeRows) => string
): ImpactSummary {
	const carried = carriedCitations(visible, commands);
	const carriedNote = carriedNotes(visible, commands);
	return {
		...describeImpact(headline(visible), visible, ops),
		...(carried ? { carriedCitations: carried } : {}),
		...(carriedNote ? { carriedNotes: carriedNote } : {})
	};
}

export class MutationRunner {
	readonly store: ChangeStore;
	private scopedLoader: ScopedRowLoader;
	private userRepo: UserRepository;
	private treeRepo: TreeRepository;

	constructor(
		db: DbClient,
		readonly clock: MutationClock = SYSTEM_CLOCK
	) {
		this.store = new ChangeStore(db);
		this.scopedLoader = new ScopedRowLoader(db);
		this.userRepo = new UserRepository(db);
		this.treeRepo = new TreeRepository(db);
	}

	async requireAccess(
		treeId: string,
		context: AuthenticatedContext,
		action: TreeAction
	): Promise<void> {
		await requireTreeAction(this.userRepo, treeId, context, action);
	}

	/** The action check plus what the caller may see of private people (ADR-015). */
	scopeFor(
		treeId: string,
		context: AuthenticatedContext,
		action: TreeAction
	): Promise<ViewerScope> {
		return requireTreeScope(
			this.userRepo,
			this.treeRepo,
			treeId,
			context,
			action,
			new Date(this.clock.now())
		);
	}

	/**
	 * The rows these commands plan over: the scoped snapshot when every kind has a seed, else the
	 * whole tree (ADR-055). A kind with no seed is the default, so nothing changes until one is added.
	 */
	private loadFor(treeId: string, commands: RelationshipCommand[]): Promise<TreeRows> {
		return this.loadForSeed(treeId, seedFor(commands));
	}

	/**
	 * Rows for a caller that knows what it reads better than its commands say, as the intent planner
	 * does. A null seed is the whole tree. A seed that opts into a follow-up costs a second load
	 * when the first snapshot shows partners or parents whose partnerships are not yet loaded; one
	 * that does not opt in, or has nothing to follow, stays at one.
	 */
	async loadForSeed(treeId: string, seed: ScopeSeed | null): Promise<TreeRows> {
		if (!seed) return this.store.loadRows(treeId);
		const first = await this.scopedLoader.load(treeId, seed);
		const next = seedWithFollowUp(first, seed);
		return next ? this.scopedLoader.load(treeId, next) : first;
	}

	/** `actorId` is required, not defaulted: a caller that forgot it would record no author and hide the person from their creator. */
	plan(
		treeId: string,
		rows: TreeRows,
		commands: RelationshipCommand[],
		actorId: string | null
	): RowOp[] {
		return buildPlanOps(rows, commands, {
			treeId,
			now: this.clock.now(),
			newId: this.clock.newId,
			actorId
		});
	}

	/**
	 * Rows as the caller may see them: a restricted viewer's have private people omitted (never
	 * placeholders, which a planner could write back). Everyone else's are the rows themselves.
	 */
	visibleRows(rows: TreeRows, scope: ViewerScope): TreeRows {
		return omitForScope(rows, scope);
	}

	/**
	 * Plan for a caller with this scope. A restricted viewer's commands are first planned over the
	 * rows they can see, so naming a private person fails exactly as naming a missing one does; the
	 * real ops are then planned over every row, and refused if they would read or write anything of
	 * a private person (ADR-015). The refusal reads as a missing permission, not as a reason.
	 */
	planFor(
		treeId: string,
		rows: TreeRows,
		commands: RelationshipCommand[],
		scope: ViewerScope
	): RowOp[] {
		if (!scope.isRestricted) return this.plan(treeId, rows, commands, scope.userId);
		this.plan(treeId, this.visibleRows(rows, scope), commands, scope.userId);
		const ops = this.plan(treeId, rows, commands, scope.userId);
		if (opsTouchPrivate(ops, rows, scope.cutoff, scope.creatorId)) {
			throw new UnauthorizedError(
				`Forbidden: insufficient privileges for action '${actionForOps(ops)}'`
			);
		}
		return ops;
	}

	/**
	 * Plan as `run` would, without writing: the rows, what the caller may see of them, and the ops.
	 * A preview names the records it would touch, so it needs the rights the change itself needs, not
	 * just `tree:view`.
	 */
	async planned(
		treeId: string,
		context: AuthenticatedContext,
		commands: RelationshipCommand[]
	): Promise<{ rows: TreeRows; visible: TreeRows; ops: RowOp[] }> {
		// `record:create` first, the weakest right any change needs: a role that can change nothing is
		// refused before planning, so it cannot tell a private record from a missing one by the error.
		const scope = await this.scopeFor(treeId, context, 'record:create');
		const rows = await this.loadFor(treeId, commands);
		const ops = this.planFor(treeId, rows, commands, scope);
		await this.requireAccess(treeId, context, actionForOps(ops));
		return { rows, visible: this.visibleRows(rows, scope), ops };
	}

	/** Read-only: what these commands would write, described. Nothing is saved. */
	async preview(
		treeId: string,
		context: AuthenticatedContext,
		commands: RelationshipCommand[],
		headline: (rows: TreeRows) => string
	): Promise<ImpactSummary> {
		const { visible, ops } = await this.planned(treeId, context, commands);
		return previewOf(visible, commands, ops, headline);
	}

	/**
	 * Plan, authorise and commit. `rows` may be passed by a caller that already loaded and planned
	 * against it, so its preview and the write share one snapshot.
	 */
	async run(
		treeId: string,
		context: AuthenticatedContext,
		change: {
			kind: string;
			summary: (rows: TreeRows) => string;
			commands: RelationshipCommand[];
			/**
			 * The right the change needs, when it is not what its ops say: a contributor edits a task
			 * they made, which is an update and would otherwise need an editor (ADR-029).
			 */
			requiredAction?: (rows: TreeRows) => TreeAction;
		},
		rows?: TreeRows
	): Promise<MutationResult> {
		// Before the role check and any read, so the refusal never depends on what the tree holds.
		requireRealUser(context);
		const scope = await this.scopeFor(treeId, context, 'record:create');
		const snapshot = rows ?? (await this.loadFor(treeId, change.commands));
		const ops = this.planFor(treeId, snapshot, change.commands, scope);
		await this.requireAccess(
			treeId,
			context,
			change.requiredAction ? change.requiredAction(snapshot) : actionForOps(ops)
		);
		// What is logged and shown back is written from the rows the caller may see.
		const seen = this.visibleRows(snapshot, scope);
		const affected = describeOps(ops, makeLabeler(seen, ops));
		const committed = await this.store.commit({
			treeId,
			actorId: context.user.id,
			kind: change.kind,
			summary: change.summary(seen),
			ops,
			changes: affected,
			isUndoable: true,
			correlationId: context.correlationId
		});
		return { change: committed, affected: committed ? affected : [] };
	}
}
