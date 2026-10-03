/**
 * Writes sources, repositories and citations through the mutation runner, so every change is
 * previewed, logged and undoable like any other (ADR-028). Reads for the sources pages and the
 * person page live in `evidence-read-service.ts` and `person-page-service.ts`.
 */

import type { DbClient } from '../db';
import { describeCommand } from '../domain/command-summary';
import type { EvidenceCommand } from '../domain/evidence-ops';
import type { AuthenticatedContext } from '../domain/identity';
import type { ImpactSummary } from '../../shared/impact';
import type {
	CitationInput,
	CitationSubjectRef,
	RepositoryInput,
	SourceInput
} from '../../shared/evidence';
import type { TreeAction } from '../auth/authorization';
import { MutationRunner, type MutationClock, type MutationResult } from './mutation-runner';

/**
 * The right a command needs, so a caller who lacks it is refused before the command is planned. A
 * plan can fail with a domain error that says something about the records (a source in use, with how
 * many citations cite it), and that must not be what a role without the right is told.
 */
const REQUIRED_ACTION: Record<EvidenceCommand['kind'], TreeAction> = {
	create_source: 'record:create',
	create_repository: 'record:create',
	link_repository: 'record:create',
	add_citation: 'record:create',
	update_source: 'record:edit',
	update_repository: 'record:edit',
	update_source_repository: 'record:edit',
	unlink_repository: 'record:edit',
	update_citation: 'record:edit',
	reorder_citations: 'record:edit',
	merge_sources: 'record:delete',
	delete_source: 'record:delete',
	delete_repository: 'record:delete',
	remove_citation: 'record:delete'
};

export class EvidenceService {
	readonly runner: MutationRunner;

	constructor(db: DbClient, clock?: MutationClock) {
		this.runner = new MutationRunner(db, clock);
	}

	private async run(
		treeId: string,
		command: EvidenceCommand,
		context: AuthenticatedContext
	): Promise<MutationResult> {
		await this.runner.requireAccess(treeId, context, REQUIRED_ACTION[command.kind]);
		return this.runner.run(treeId, context, {
			kind: command.kind,
			summary: (rows) => describeCommand(command, rows),
			commands: [command]
		});
	}

	/** What an evidence change would write, without writing it. */
	async preview(
		treeId: string,
		command: EvidenceCommand,
		context: AuthenticatedContext
	): Promise<ImpactSummary> {
		await this.runner.requireAccess(treeId, context, REQUIRED_ACTION[command.kind]);
		return this.runner.preview(treeId, context, [command], (rows) =>
			describeCommand(command, rows)
		);
	}

	async createSource(
		treeId: string,
		source: SourceInput,
		context: AuthenticatedContext
	): Promise<{ sourceId: string } & MutationResult> {
		const sourceId = this.runner.clock.newId();
		const result = await this.run(treeId, { kind: 'create_source', sourceId, source }, context);
		return { sourceId, ...result };
	}

	updateSource(
		treeId: string,
		sourceId: string,
		source: SourceInput,
		expectedVersion: number,
		context: AuthenticatedContext
	) {
		return this.run(treeId, { kind: 'update_source', sourceId, expectedVersion, source }, context);
	}

	deleteSource(
		treeId: string,
		sourceId: string,
		options: { expectedVersion?: number; shouldRemoveCitations?: boolean },
		context: AuthenticatedContext
	) {
		return this.run(treeId, { kind: 'delete_source', sourceId, ...options }, context);
	}

	mergeSources(
		treeId: string,
		survivorId: string,
		mergedIds: string[],
		expectedVersions: Record<string, number> | undefined,
		context: AuthenticatedContext
	) {
		return this.run(
			treeId,
			{ kind: 'merge_sources', survivorId, mergedIds, expectedVersions },
			context
		);
	}

	async createRepository(
		treeId: string,
		repository: RepositoryInput,
		context: AuthenticatedContext
	): Promise<{ repositoryId: string } & MutationResult> {
		const repositoryId = this.runner.clock.newId();
		const result = await this.run(
			treeId,
			{ kind: 'create_repository', repositoryId, repository },
			context
		);
		return { repositoryId, ...result };
	}

	updateRepository(
		treeId: string,
		repositoryId: string,
		repository: RepositoryInput,
		expectedVersion: number,
		context: AuthenticatedContext
	) {
		return this.run(
			treeId,
			{ kind: 'update_repository', repositoryId, expectedVersion, repository },
			context
		);
	}

	deleteRepository(
		treeId: string,
		repositoryId: string,
		expectedVersion: number | undefined,
		context: AuthenticatedContext
	) {
		return this.run(treeId, { kind: 'delete_repository', repositoryId, expectedVersion }, context);
	}

	async linkRepository(
		treeId: string,
		sourceId: string,
		repositoryId: string,
		callNumber: string | null,
		context: AuthenticatedContext
	): Promise<{ linkId: string } & MutationResult> {
		const linkId = this.runner.clock.newId();
		const result = await this.run(
			treeId,
			{ kind: 'link_repository', linkId, sourceId, repositoryId, callNumber },
			context
		);
		return { linkId, ...result };
	}

	updateSourceRepository(
		treeId: string,
		linkId: string,
		callNumber: string | null,
		expectedVersion: number,
		context: AuthenticatedContext
	) {
		return this.run(
			treeId,
			{ kind: 'update_source_repository', linkId, expectedVersion, callNumber },
			context
		);
	}

	unlinkRepository(
		treeId: string,
		linkId: string,
		expectedVersion: number | undefined,
		context: AuthenticatedContext
	) {
		return this.run(treeId, { kind: 'unlink_repository', linkId, expectedVersion }, context);
	}

	async addCitation(
		treeId: string,
		subject: CitationSubjectRef,
		citation: CitationInput,
		context: AuthenticatedContext
	): Promise<{ citationId: string } & MutationResult> {
		const citationId = this.runner.clock.newId();
		const result = await this.run(
			treeId,
			{ kind: 'add_citation', citationId, subject, citation },
			context
		);
		return { citationId, ...result };
	}

	updateCitation(
		treeId: string,
		citationId: string,
		citation: CitationInput,
		expectedVersion: number,
		context: AuthenticatedContext
	) {
		return this.run(
			treeId,
			{ kind: 'update_citation', citationId, expectedVersion, citation },
			context
		);
	}

	removeCitation(
		treeId: string,
		citationId: string,
		expectedVersion: number | undefined,
		context: AuthenticatedContext
	) {
		return this.run(treeId, { kind: 'remove_citation', citationId, expectedVersion }, context);
	}

	reorderCitations(
		treeId: string,
		subject: CitationSubjectRef,
		orderedCitationIds: string[],
		context: AuthenticatedContext
	) {
		return this.run(treeId, { kind: 'reorder_citations', subject, orderedCitationIds }, context);
	}
}
