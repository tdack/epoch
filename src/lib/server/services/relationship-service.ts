/**
 * Phase 2 relationship service: turns an intent into a validated plan, previews it exactly, and
 * applies it through the mutation runner, which logs it. Enforces tree authorization and returns
 * the preview sentence plus what was written.
 */

import type { DbClient } from '../db';
import { RelationshipRepository } from '../repositories/relationship-repository';
import { pastTense, describeCommand } from '../domain/command-summary';
import { ValidationError } from '../domain/errors';
import type { AuthenticatedContext } from '../domain/identity';
import { describeImpact, type ImpactSummary } from '../domain/impact';
import { graphFromRows } from '../domain/relationship-graph';
import { planRelationshipCommand, type RelationshipCommand, type RelationshipPlan } from '../domain/relationship-commands';
import type { RelationshipIntent } from '../domain/relationship-sentence';
import type { TreeRows } from '../domain/change-log';
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

export class RelationshipService {
	private repo: RelationshipRepository;
	readonly runner: MutationRunner;

	constructor(db: DbClient, clock?: MutationClock) {
		this.repo = new RelationshipRepository(db);
		this.runner = new MutationRunner(db, clock);
	}

	private async planFor(treeId: string, intent: RelationshipIntent, context: AuthenticatedContext) {
		await this.runner.requireAccess(treeId, context, 'record:create');
		const rows = await this.runner.store.loadRows(treeId);
		const plan = planRelationshipCommand(intent, {
			rows,
			hasDuplicateName: await this.hasDuplicate(treeId, intent),
			newId: this.runner.clock.newId
		});
		return { rows, plan };
	}

	/** Produce a preview for an intent without writing anything. */
	async plan(treeId: string, intent: RelationshipIntent, context: AuthenticatedContext): Promise<PreviewedPlan> {
		const { rows, plan } = await this.planFor(treeId, intent, context);
		const ops = this.runner.plan(treeId, rows, plan.commands);
		return { ...plan, impact: describeImpact(plan.sentence, rows, ops) };
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
		await this.runner.requireAccess(treeId, context, 'tree:view');
		const rows = await this.runner.store.loadRows(treeId);
		return describeImpact(this.removalHeadline(rows, command), rows, this.runner.plan(treeId, rows, [command]));
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

	async searchPeople(treeId: string, query: string, context: AuthenticatedContext) {
		await this.runner.requireAccess(treeId, context, 'tree:view');
		return this.repo.searchPeople(treeId, query);
	}

	async getGraph(treeId: string, context: AuthenticatedContext) {
		await this.runner.requireAccess(treeId, context, 'tree:view');
		return graphFromRows(await this.runner.store.loadRows(treeId));
	}

	private async hasDuplicate(treeId: string, intent: RelationshipIntent): Promise<boolean> {
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
			default:
				return false;
		}
		const name = ref.givenName ?? ref.surname;
		if (!name?.trim()) return false;
		const matches = await this.repo.searchPeople(treeId, name);
		// A match is a duplicate cue when it is a different person than the one being linked. A
		// person being created has no id yet, so any match is a cue.
		return matches.some((m) => ref.isNew || m.id !== ref.id);
	}
}
