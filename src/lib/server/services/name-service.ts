/**
 * Writes a person's names through the mutation runner, so every name change is previewed, logged
 * and undoable like any other. The person page reads them in `person-page-service.ts`.
 */

import type { DbClient } from '../db';
import { describeCommand } from '../domain/command-summary';
import type { AuthenticatedContext } from '../domain/identity';
import { describeImpact, type ImpactSummary } from '../domain/impact';
import type { NameCommand } from '../domain/name-ops';
import { MutationRunner, type MutationClock, type MutationResult } from './mutation-runner';
import type { NameInput } from '../../shared/name-types';

export class NameService {
	readonly runner: MutationRunner;

	constructor(db: DbClient, clock?: MutationClock) {
		this.runner = new MutationRunner(db, clock);
	}

	private run(treeId: string, command: NameCommand, context: AuthenticatedContext): Promise<MutationResult> {
		return this.runner.run(treeId, context, {
			kind: command.kind,
			summary: (rows) => describeCommand(command, rows),
			commands: [command]
		});
	}

	/** What a name change would write, without writing it. */
	async preview(treeId: string, command: NameCommand, context: AuthenticatedContext): Promise<ImpactSummary> {
		await this.runner.requireAccess(treeId, context, 'tree:view');
		const rows = await this.runner.store.loadRows(treeId);
		return describeImpact(describeCommand(command, rows), rows, this.runner.plan(treeId, rows, [command]));
	}

	async create(treeId: string, personId: string, name: NameInput, isPreferred: boolean, context: AuthenticatedContext): Promise<{ nameId: string } & MutationResult> {
		const nameId = this.runner.clock.newId();
		const result = await this.run(treeId, { kind: 'create_name', personId, nameId, name, isPreferred }, context);
		return { nameId, ...result };
	}

	update(treeId: string, nameId: string, name: Partial<NameInput>, expectedVersion: number, context: AuthenticatedContext) {
		return this.run(treeId, { kind: 'update_name', nameId, expectedVersion, name }, context);
	}

	remove(treeId: string, nameId: string, expectedVersion: number | undefined, context: AuthenticatedContext) {
		return this.run(treeId, { kind: 'delete_name', nameId, expectedVersion }, context);
	}

	reorder(treeId: string, personId: string, orderedNameIds: string[], context: AuthenticatedContext) {
		return this.run(treeId, { kind: 'reorder_names', personId, orderedNameIds }, context);
	}

	setPreferred(treeId: string, personId: string, nameId: string, expectedVersion: number | undefined, context: AuthenticatedContext) {
		return this.run(treeId, { kind: 'set_preferred_name', personId, nameId, expectedVersion }, context);
	}
}
