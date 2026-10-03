/**
 * Writes a person's facts through the mutation runner, so every fact change is previewed, logged
 * and undoable like any other. Reads for the person page live in `person-page-service.ts`.
 */

import type { DbClient } from '../db';
import { describeCommand } from '../domain/command-summary';
import type { AuthenticatedContext } from '../domain/identity';
import type { ImpactSummary } from '../../shared/impact';
import type { FactCommand } from '../domain/fact-ops';
import { MutationRunner, type MutationClock, type MutationResult } from './mutation-runner';
import type { FactInput } from '../../shared/fact-types';

export class FactService {
	readonly runner: MutationRunner;

	constructor(db: DbClient, clock?: MutationClock) {
		this.runner = new MutationRunner(db, clock);
	}

	private run(
		treeId: string,
		command: FactCommand,
		context: AuthenticatedContext
	): Promise<MutationResult> {
		return this.runner.run(treeId, context, {
			kind: command.kind,
			summary: (rows) => describeCommand(command, rows),
			commands: [command]
		});
	}

	/** What a fact change would write, without writing it. */
	async preview(
		treeId: string,
		command: FactCommand,
		context: AuthenticatedContext
	): Promise<ImpactSummary> {
		return this.runner.preview(treeId, context, [command], (rows) =>
			describeCommand(command, rows)
		);
	}

	async create(
		treeId: string,
		personId: string,
		fact: FactInput,
		context: AuthenticatedContext
	): Promise<{ factId: string } & MutationResult> {
		const factId = this.runner.clock.newId();
		const result = await this.run(treeId, { kind: 'create_fact', personId, factId, fact }, context);
		return { factId, ...result };
	}

	update(
		treeId: string,
		factId: string,
		fact: Partial<FactInput>,
		expectedVersion: number,
		context: AuthenticatedContext
	) {
		return this.run(treeId, { kind: 'update_fact', factId, expectedVersion, fact }, context);
	}

	remove(
		treeId: string,
		factId: string,
		expectedVersion: number | undefined,
		context: AuthenticatedContext
	) {
		return this.run(treeId, { kind: 'delete_fact', factId, expectedVersion }, context);
	}

	reorder(
		treeId: string,
		personId: string,
		orderedFactIds: string[],
		context: AuthenticatedContext
	) {
		return this.run(treeId, { kind: 'reorder_facts', personId, orderedFactIds }, context);
	}
}
