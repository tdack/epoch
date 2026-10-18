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
import { CITATION_SUBJECT_KINDS, type CitationInput } from '../../shared/evidence';

export class FactService {
	readonly runner: MutationRunner;

	constructor(db: DbClient, clock?: MutationClock) {
		this.runner = new MutationRunner(db, clock);
	}

	/**
	 * A citation sent with the fact rides in the same run, so the fact and its source are one change
	 * and one Undo. It is planned over the rows the fact command produced, so it may cite a fact
	 * that does not exist yet, and its ops are inserts, which need only the right to create.
	 */
	private run(
		treeId: string,
		command: FactCommand,
		context: AuthenticatedContext,
		cited?: { factId: string; citation: CitationInput }
	): Promise<MutationResult> {
		return this.runner.run(treeId, context, {
			kind: command.kind,
			summary: (rows) => describeCommand(command, rows),
			commands: cited
				? [
						command,
						{
							kind: 'add_citation',
							citationId: this.runner.clock.newId(),
							subject: { kind: CITATION_SUBJECT_KINDS.EVENT, id: cited.factId },
							citation: cited.citation
						}
					]
				: [command]
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
		context: AuthenticatedContext,
		citation?: CitationInput
	): Promise<{ factId: string } & MutationResult> {
		const factId = this.runner.clock.newId();
		const result = await this.run(
			treeId,
			{ kind: 'create_fact', personId, factId, fact },
			context,
			citation && { factId, citation }
		);
		return { factId, ...result };
	}

	update(
		treeId: string,
		factId: string,
		fact: Partial<FactInput>,
		expectedVersion: number,
		context: AuthenticatedContext,
		citation?: CitationInput
	) {
		return this.run(
			treeId,
			{ kind: 'update_fact', factId, expectedVersion, fact },
			context,
			citation && { factId, citation }
		);
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
