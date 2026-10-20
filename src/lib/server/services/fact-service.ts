/**
 * Writes a person's facts through the mutation runner, so every fact change is previewed, logged
 * and undoable like any other. Reads for the person page live in `person-page-service.ts`.
 */

import type { DbClient } from '../db';
import { describeCommand, describeGroupFact } from '../domain/command-summary';
import type { AuthenticatedContext } from '../domain/identity';
import type { ImpactSummary } from '../../shared/impact';
import type { FactCommand } from '../domain/fact-ops';
import type { RelationshipCommand } from '../domain/relationship-commands';
import { MutationRunner, type MutationClock, type MutationResult } from './mutation-runner';
import { MAX_GROUP_FACT_PEOPLE, type FactInput } from '../../shared/fact-types';
import { ValidationError } from '../domain/errors';
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

	/** The group's commands: one fact per person, each with its own copy of the citation. */
	private groupCommands(
		personIds: string[],
		fact: FactInput,
		citation?: CitationInput
	): { factIds: string[]; commands: RelationshipCommand[] } {
		const unique = [...new Set(personIds)];
		if (unique.length === 0 || unique.length > MAX_GROUP_FACT_PEOPLE)
			throw new ValidationError(`Choose between 1 and ${MAX_GROUP_FACT_PEOPLE} people.`);
		const factIds = unique.map(() => this.runner.clock.newId());
		const commands = unique.flatMap((personId, i): RelationshipCommand[] => [
			{ kind: 'create_fact', personId, factId: factIds[i], fact },
			...(citation
				? [
						{
							kind: 'add_citation' as const,
							citationId: this.runner.clock.newId(),
							subject: { kind: CITATION_SUBJECT_KINDS.EVENT, id: factIds[i] },
							citation
						}
					]
				: [])
		]);
		return { factIds, commands };
	}

	/**
	 * One fact copied onto each person: N independent events, so a later edit of one copy does not
	 * reach the others (ADR-071). All in one run, so one change-log entry and one Undo.
	 */
	async createMany(
		treeId: string,
		personIds: string[],
		fact: FactInput,
		context: AuthenticatedContext,
		citation?: CitationInput
	): Promise<{ factIds: string[] } & MutationResult> {
		const { factIds, commands } = this.groupCommands(personIds, fact, citation);
		const result = await this.runner.run(treeId, context, {
			kind: 'create_group_fact',
			summary: () => describeGroupFact(fact.type, factIds.length),
			commands
		});
		return { factIds, ...result };
	}

	/** What `createMany` would write, without writing it. */
	previewMany(
		treeId: string,
		personIds: string[],
		fact: FactInput,
		context: AuthenticatedContext
	): Promise<ImpactSummary> {
		const { factIds, commands } = this.groupCommands(personIds, fact);
		return this.runner.preview(treeId, context, commands, () =>
			describeGroupFact(fact.type, factIds.length)
		);
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
