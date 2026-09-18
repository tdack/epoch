/**
 * Phase 2 relationship service: turns an intent into a validated plan and
 * applies it against the neutral model. Enforces tree authorization and
 * returns the preview sentence plus applied command results.
 */

import type { DbClient } from '../db';
import { UserRepository } from '../repositories/user-repository';
import { RelationshipRepository } from '../repositories/relationship-repository';
import { isActionAllowed } from '../auth/authorization';
import { UnauthorizedError } from '../domain/errors';
import { planRelationshipCommand, type RelationshipPlan, type RelationshipCommand } from '../domain/relationship-commands';
import type { RelationshipIntent } from '../domain/relationship-sentence';
import type { AuthenticatedContext } from '../domain/identity';

/** A record of an applied command, enabling undo of the last safe mutation. */
export interface AppliedCommand {
	command: RelationshipCommand;
	/** Concrete union ID produced by a create_union, when applicable. */
	createdUnionId: string | null;
	impactSummary: string;
}

export class RelationshipService {
	private userRepo: UserRepository;
	private relationshipRepo: RelationshipRepository;
	private lastApplied: AppliedCommand[] = [];

	constructor(private db: DbClient) {
		this.userRepo = new UserRepository(db);
		this.relationshipRepo = new RelationshipRepository(db);
	}

	private async verifyAccess(treeId: string, context: AuthenticatedContext, action: Parameters<typeof isActionAllowed>[1]) {
		const membership = await this.userRepo.getMembership(treeId, context.user.id);
		if (!membership || !isActionAllowed(membership.role, action)) {
			throw new UnauthorizedError(`Forbidden: insufficient privileges for action '${action}'`);
		}
	}

	/**
	 * Produce a preview plan for an intent without writing anything.
	 */
	async plan(treeId: string, intent: RelationshipIntent, context: AuthenticatedContext): Promise<RelationshipPlan> {
		await this.verifyAccess(treeId, context, 'record:create');

		const [assertions, subjectId] = await Promise.all([
			this.relationshipRepo.listAssertions(treeId),
			this.subjectIdForIntent(intent)
		]);

		const unionCount = subjectId ? await this.relationshipRepo.countUnionsForPerson(subjectId) : 0;
		const hasDuplicateName = await this.hasDuplicate(treeId, intent);

		return planRelationshipCommand(intent, { assertions, hasDuplicateName, unionCount });
	}

	/**
	 * Apply a planned intent. Re-plans (to re-validate invariants against the
	 * latest state) and then executes each command in order.
	 */
	async execute(treeId: string, intent: RelationshipIntent, context: AuthenticatedContext): Promise<RelationshipPlan> {
		await this.verifyAccess(treeId, context, 'record:create');

		const assertions = await this.relationshipRepo.listAssertions(treeId);
		const subjectId = await this.subjectIdForIntent(intent);
		const unionCount = subjectId ? await this.relationshipRepo.countUnionsForPerson(subjectId) : 0;
		const hasDuplicateName = await this.hasDuplicate(treeId, intent);

		const plan = planRelationshipCommand(intent, { assertions, hasDuplicateName, unionCount });

		for (const command of plan.commands) {
			const createdUnionId = await this.relationshipRepo.applyCommand(treeId, command);
			const impactSummary = await this.relationshipRepo.summarizeImpact(treeId, command);
			this.lastApplied.push({ command, createdUnionId, impactSummary });
		}

		return plan;
	}

	/** Preview the impact summary of a planned intent (no write). */
	async previewImpact(treeId: string, intent: RelationshipIntent, context: AuthenticatedContext): Promise<string[]> {
		await this.verifyAccess(treeId, context, 'record:create');
		const assertions = await this.relationshipRepo.listAssertions(treeId);
		const plan = planRelationshipCommand(intent, { assertions, hasDuplicateName: false, unionCount: 0 });
		return Promise.all(plan.commands.map((c) => this.relationshipRepo.summarizeImpact(treeId, c)));
	}

	/** Undo the last applied command in this service instance (in-memory). */
	async undoLast(treeId: string, context: AuthenticatedContext): Promise<AppliedCommand | null> {
		await this.verifyAccess(treeId, context, 'record:edit');
		const last = this.lastApplied.pop();
		if (!last) return null;

		const inverse = this.relationshipRepo.inverseOf(last.command);
		if (inverse) {
			await this.relationshipRepo.applyCommand(treeId, inverse);
		} else if (last.command.kind === 'create_union' && last.createdUnionId) {
			// Undo a create_union by ending the concrete union.
			await this.relationshipRepo.applyCommand(treeId, {
				kind: 'end_union',
				unionId: last.createdUnionId
			});
		} else if (last.command.kind === 'end_union') {
			// Re-activate the union by recreating it is out of scope; report the
			// action as non-undoable here (no person data is lost).
			return last;
		}

		return last;
	}

	async searchPeople(treeId: string, query: string, context: AuthenticatedContext) {
		await this.verifyAccess(treeId, context, 'tree:view');
		return this.relationshipRepo.searchPeople(treeId, query);
	}

	async getGraph(treeId: string, context: AuthenticatedContext) {
		await this.verifyAccess(treeId, context, 'tree:view');
		return this.relationshipRepo.getGraph(treeId);
	}

	private async subjectIdForIntent(intent: RelationshipIntent): Promise<string | null> {
		switch (intent.kind) {
			case 'add_parent':
				return intent.child.id;
			case 'add_child':
				return intent.parent.id;
			case 'add_partner':
				return intent.person.id;
			case 'record_death':
				return intent.person.id;
			case 'end_union':
				return intent.person.id;
		}
	}

	private async hasDuplicate(treeId: string, intent: RelationshipIntent): Promise<boolean> {
		let name: string | null = null;
		switch (intent.kind) {
			case 'add_parent':
				name = intent.parent.givenName ?? intent.parent.surname;
				break;
			case 'add_child':
				name = intent.child.givenName ?? intent.child.surname;
				break;
			case 'add_partner':
				name = intent.partner.givenName ?? intent.partner.surname;
				break;
			default:
				return false;
		}
		if (!name?.trim()) return false;
		const matches = await this.relationshipRepo.searchPeople(treeId, name);
		// A match is a duplicate cue when it is a different person than the
		// one being linked.
		const linkedId =
			intent.kind === 'add_parent'
				? intent.parent.id
				: intent.kind === 'add_child'
					? intent.child.id
					: intent.partner.id;
		return matches.some((m) => m.id !== linkedId);
	}
}
