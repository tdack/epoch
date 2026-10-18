/**
 * Writes a person's names through the mutation runner, so every name change is previewed, logged
 * and undoable like any other. The person page reads them in `person-page-service.ts`.
 */

import type { DbClient } from '../db';
import { describeCommand } from '../domain/command-summary';
import type { AuthenticatedContext } from '../domain/identity';
import type { ImpactSummary } from '../../shared/impact';
import type { NameCommand } from '../domain/name-ops';
import { MutationRunner, type MutationClock, type MutationResult } from './mutation-runner';
import type { NameInput } from '../../shared/name-types';
import { CITATION_SUBJECT_KINDS, type CitationInput } from '../../shared/evidence';

export class NameService {
	readonly runner: MutationRunner;

	constructor(db: DbClient, clock?: MutationClock) {
		this.runner = new MutationRunner(db, clock);
	}

	/** A citation sent with the name rides in the same run: one change, one Undo (as for facts). */
	private run(
		treeId: string,
		command: NameCommand,
		context: AuthenticatedContext,
		cited?: { nameId: string; citation: CitationInput }
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
							subject: { kind: CITATION_SUBJECT_KINDS.NAME, id: cited.nameId },
							citation: cited.citation
						}
					]
				: [command]
		});
	}

	/** What a name change would write, without writing it. */
	async preview(
		treeId: string,
		command: NameCommand,
		context: AuthenticatedContext
	): Promise<ImpactSummary> {
		return this.runner.preview(treeId, context, [command], (rows) =>
			describeCommand(command, rows)
		);
	}

	async create(
		treeId: string,
		personId: string,
		name: NameInput,
		isPreferred: boolean,
		context: AuthenticatedContext,
		citation?: CitationInput
	): Promise<{ nameId: string } & MutationResult> {
		const nameId = this.runner.clock.newId();
		const result = await this.run(
			treeId,
			{ kind: 'create_name', personId, nameId, name, isPreferred },
			context,
			citation && { nameId, citation }
		);
		return { nameId, ...result };
	}

	update(
		treeId: string,
		nameId: string,
		name: Partial<NameInput>,
		expectedVersion: number,
		context: AuthenticatedContext,
		citation?: CitationInput
	) {
		return this.run(
			treeId,
			{ kind: 'update_name', nameId, expectedVersion, name },
			context,
			citation && { nameId, citation }
		);
	}

	remove(
		treeId: string,
		nameId: string,
		expectedVersion: number | undefined,
		context: AuthenticatedContext
	) {
		return this.run(treeId, { kind: 'delete_name', nameId, expectedVersion }, context);
	}

	reorder(
		treeId: string,
		personId: string,
		orderedNameIds: string[],
		context: AuthenticatedContext
	) {
		return this.run(treeId, { kind: 'reorder_names', personId, orderedNameIds }, context);
	}

	setPreferred(
		treeId: string,
		personId: string,
		nameId: string,
		expectedVersion: number | undefined,
		context: AuthenticatedContext
	) {
		return this.run(
			treeId,
			{ kind: 'set_preferred_name', personId, nameId, expectedVersion },
			context
		);
	}
}
