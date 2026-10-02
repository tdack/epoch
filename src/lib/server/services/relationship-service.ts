/**
 * Phase 2 relationship service: turns an intent into a validated plan, previews it exactly, and
 * applies it through the mutation runner, which logs it. Enforces tree authorization and returns
 * the preview sentence plus what was written.
 */

import type { DbClient } from '../db';
import { SearchRepository } from '../repositories/search-repository';
import { searchWords } from '../../shared/search';
import { pastTense, describeCommand } from '../domain/command-summary';
import { ValidationError } from '../domain/errors';
import type { AuthenticatedContext } from '../domain/identity';
import { describeImpact, type ImpactSummary } from '../domain/impact';
import { maskRows } from '../domain/privacy-mask';
import { graphFromRows } from '../domain/relationship-graph';
import { planRelationshipCommand, type RelationshipCommand, type RelationshipPlan } from '../domain/relationship-commands';
import type { RelationshipIntent } from '../domain/relationship-sentence';
import type { TreeRows } from '../domain/change-log';
import { mergeConflictsOf } from '../domain/tree-ops';
import { unresolvedConflicts, type MergeConflict } from '../../shared/union-merge';
import type { ViewerScope } from './tree-access';
import { MutationRunner, type MutationClock, type MutationResult } from './mutation-runner';

/** A plan plus the exact records it would write. */
export interface PreviewedPlan extends RelationshipPlan {
	impact: ImpactSummary;
}

export interface ExecutedPlan extends RelationshipPlan, MutationResult {}

/** Commands the canvas and drawers submit directly to remove something; none of them can delete unrelated history. */
export type RemovalCommand = Extract<
	RelationshipCommand,
	{ kind: 'remove_parent_child' | 'remove_partner_from_union' | 'destroy_union' | 'delete_person' }
>;

export type MergeUnionsCommand = Extract<RelationshipCommand, { kind: 'merge_unions' }>;

/** What a merge would do: every conflict, and the records it would write once none is left open. */
export interface MergePreview {
	conflicts: MergeConflict[];
	/** Null while any conflict has no choice; the dialog asks first. */
	impact: ImpactSummary | null;
}

export class RelationshipService {
	private search: SearchRepository;
	readonly runner: MutationRunner;

	constructor(db: DbClient, clock?: MutationClock) {
		this.search = new SearchRepository(db);
		this.runner = new MutationRunner(db, clock);
	}

	private async planFor(treeId: string, intent: RelationshipIntent, context: AuthenticatedContext) {
		const scope = await this.runner.scopeFor(treeId, context, 'record:create');
		const rows = await this.runner.store.loadRows(treeId);
		// A restricted viewer's sentence and checks run over the rows they can see, so it can name
		// nobody they may not (ADR-015); `plan` and `execute` then guard the real ops.
		const visible = this.runner.visibleRows(rows, scope);
		const plan = planRelationshipCommand(intent, {
			rows: visible,
			hasDuplicateName: await this.hasDuplicate(treeId, intent, scope),
			newId: this.runner.clock.newId
		});
		return { rows, visible, scope, plan };
	}

	/** Produce a preview for an intent without writing anything. */
	async plan(treeId: string, intent: RelationshipIntent, context: AuthenticatedContext): Promise<PreviewedPlan> {
		const { rows, visible, scope, plan } = await this.planFor(treeId, intent, context);
		const ops = this.runner.planFor(treeId, rows, plan.commands, scope);
		return { ...plan, impact: describeImpact(plan.sentence, visible, ops) };
	}

	/**
	 * Apply an intent. Re-plans against the latest state, so invariants are checked at the moment
	 * of writing, not when the preview was shown.
	 */
	async execute(treeId: string, intent: RelationshipIntent, context: AuthenticatedContext): Promise<ExecutedPlan> {
		const { rows, plan } = await this.planFor(treeId, intent, context);
		const result = await this.runner.run(
			treeId,
			context,
			{ kind: intent.kind, summary: () => pastTense(plan.sentence), commands: plan.commands },
			rows
		);
		return { ...plan, ...result };
	}

	private removalHeadline(rows: TreeRows, command: RemovalCommand): string {
		return describeCommand(command, rows);
	}

	/** What removing something would write, without writing it. Destructive actions show this first. */
	async previewRemoval(treeId: string, command: RemovalCommand, context: AuthenticatedContext): Promise<ImpactSummary> {
		return this.runner.preview(treeId, context, [command], (rows) => this.removalHeadline(rows, command));
	}

	/**
	 * Apply a concrete removal from the canvas: a parent link, a partner, or a whole union. Never
	 * deletes people; deleting a person goes through the person service.
	 */
	async removeRelationship(treeId: string, command: RemovalCommand, context: AuthenticatedContext): Promise<MutationResult> {
		if (command.kind === 'delete_person') throw new ValidationError('Use the person endpoint to delete a person');
		return this.runner.run(treeId, context, {
			kind: command.kind,
			summary: (rows) => describeCommand(command, rows),
			commands: [command]
		});
	}

	/** Edit a partnership's status and events (the union editor). */
	async updateUnion(
		treeId: string,
		command: Extract<RelationshipCommand, { kind: 'update_union' }>,
		context: AuthenticatedContext
	): Promise<MutationResult> {
		return this.runner.run(treeId, context, {
			kind: 'update_union',
			summary: (rows) => describeCommand(command, rows),
			commands: [command]
		});
	}

	/** Preview a merge without writing. Open conflicts come back as data, not as an error. */
	async previewMerge(treeId: string, command: MergeUnionsCommand, context: AuthenticatedContext): Promise<MergePreview> {
		// Conflicts are read first, from the rows the caller may see; planning (and its rights check)
		// follows only once none is left open, as before.
		const scope = await this.runner.scopeFor(treeId, context, 'record:delete');
		const visible = this.runner.visibleRows(await this.runner.store.loadRows(treeId), scope);
		const conflicts = mergeConflictsOf(visible, [command.survivorId, ...command.mergedIds]);
		if (unresolvedConflicts(conflicts, command.keep).length > 0) return { conflicts, impact: null };
		return { conflicts, impact: await this.runner.preview(treeId, context, [command], (rows) => describeCommand(command, rows)) };
	}

	/** Merge partnerships between the same people into one. Refuses while a conflict has no choice. */
	async mergeUnions(treeId: string, command: MergeUnionsCommand, context: AuthenticatedContext): Promise<MutationResult> {
		return this.runner.run(treeId, context, {
			kind: 'merge_unions',
			summary: (rows) => describeCommand(command, rows),
			commands: [command]
		});
	}

	async getGraph(treeId: string, context: AuthenticatedContext) {
		const scope = await this.runner.scopeFor(treeId, context, 'tree:view');
		const rows = await this.runner.store.loadRows(treeId);
		// The whole-tree graph is masked like the window is: placeholders when the tree allows structure.
		if (!scope.isRestricted) return graphFromRows(rows);
		const { rows: masked, placeholderIds } = maskRows(rows, scope.cutoff, scope.shouldShowPrivateStructure, scope.creatorId);
		return graphFromRows(masked, placeholderIds);
	}

	// A restricted viewer's cue ignores private people, or "this name already exists" would tell a
	// contributor that a private person has it (ADR-015).
	private async hasDuplicate(treeId: string, intent: RelationshipIntent, scope: ViewerScope): Promise<boolean> {
		let ref;
		switch (intent.kind) {
			case 'add_parent':
				ref = intent.parent;
				break;
			case 'add_child':
				ref = intent.child;
				break;
			case 'add_partner':
				ref = intent.partner;
				break;
			case 'add_sibling':
				ref = intent.sibling;
				break;
			default:
				return false;
		}
		const name = ref.givenName ?? ref.surname;
		if (!name?.trim()) return false;
		const { hits } = await this.search.find(treeId, { words: searchWords(name), place: '', from: '', to: '', limit: 25, offset: 0 }, scope);
		// A match is a duplicate cue when it is a different person than the one being linked. A
		// person being created has no id yet, so any match is a cue.
		return hits.some((h) => ref.isNew || h.personId !== ref.id);
	}
}
