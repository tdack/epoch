/**
 * Writes sources, repositories and citations through the mutation runner, so every change is
 * previewed, logged and undoable like any other (ADR-028). Reads for the sources pages and the
 * person page live in `evidence-read-service.ts` and `person-page-service.ts`.
 */

import type { DbClient } from '../db';
import { describeCommand, describeGroupCitation } from '../domain/command-summary';
import { NotFoundError, ValidationError } from '../domain/errors';
import { seedFor } from '../domain/write-scope/index';
import { MAX_GROUP_FACT_PEOPLE } from '../../shared/fact-types';
import { CITATION_SUBJECT_KINDS, MAX_EVIDENCE_OPS } from '../../shared/evidence';
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
		options: {
			expectedVersion?: number;
			shouldRemoveCitations?: boolean;
			expectedCitationCount?: number;
		},
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

	/**
	 * One command per person, or per matching fact of each person when `factType` is set, minus
	 * whatever the caller can see already cites this source.
	 */
	private async citeManyPlan(
		treeId: string,
		sourceId: string,
		personIds: string[],
		citation: CitationInput,
		factType: string | undefined,
		context: AuthenticatedContext
	) {
		const unique = [...new Set(personIds)];
		if (unique.length === 0 || unique.length > MAX_GROUP_FACT_PEOPLE)
			throw new ValidationError(`Choose between 1 and ${MAX_GROUP_FACT_PEOPLE} people.`);
		const scope = await this.runner.scopeFor(treeId, context, 'record:create');
		const add = (kind: CitationSubjectRef['kind'], id: string): EvidenceCommand => ({
			kind: 'add_citation',
			citationId: this.runner.clock.newId(),
			subject: { kind, id } as CitationSubjectRef,
			citation: { ...citation, sourceId }
		});
		const all = unique.map((id) => add(CITATION_SUBJECT_KINDS.PERSON, id));
		const rows = this.runner.visibleRows(
			await this.runner.loadForSeed(treeId, seedFor(all)),
			scope
		);
		const cited = new Set(
			rows.citations
				.filter((c) => c.sourceId === sourceId)
				.map((c) => `${c.subjectKind}:${c.subjectId}`)
		);
		const isCited = (kind: string, id: string) => cited.has(`${kind}:${id}`);
		if (!factType) {
			const skippedPersonIds = unique.filter((id) => isCited(CITATION_SUBJECT_KINDS.PERSON, id));
			const commands = all.filter(
				(c) => c.kind === 'add_citation' && !isCited(CITATION_SUBJECT_KINDS.PERSON, c.subject.id)
			);
			return { commands, skippedPersonIds, missingFactPersonIds: [] as string[] };
		}
		// A person the caller cannot see answers as a missing one, as the person-level plan does.
		const known = new Set(rows.individuals.map((i) => i.id));
		for (const id of unique) if (!known.has(id)) throw new NotFoundError('Person', id);
		const commands: EvidenceCommand[] = [];
		const skippedPersonIds: string[] = [];
		const missingFactPersonIds: string[] = [];
		for (const id of unique) {
			const facts = rows.events.filter(
				(e) => e.entityType === 'INDIVIDUAL' && e.entityId === id && e.type === factType
			);
			if (facts.length === 0) missingFactPersonIds.push(id);
			const todo = facts.filter((e) => !isCited(CITATION_SUBJECT_KINDS.EVENT, e.id));
			if (facts.length > 0 && todo.length === 0) skippedPersonIds.push(id);
			for (const e of todo) commands.push(add(CITATION_SUBJECT_KINDS.EVENT, e.id));
		}
		// Each citation added is one row written, so the command count is the change's size.
		if (commands.length > MAX_EVIDENCE_OPS)
			throw new ValidationError(
				`That would add ${commands.length} citations, and one change writes at most ${MAX_EVIDENCE_OPS}. Choose fewer people.`
			);
		return { commands, skippedPersonIds, missingFactPersonIds };
	}

	/**
	 * Cite one source for each person, as a citation on the person, or on each of their `factType`
	 * facts (ADR-028 gives a citation one subject, so this is N citations, not one shared). Already
	 * cited people or facts are skipped, and people with no such fact are reported.
	 */
	async citeMany(
		treeId: string,
		sourceId: string,
		personIds: string[],
		citation: CitationInput,
		factType: string | undefined,
		context: AuthenticatedContext
	): Promise<{ skippedPersonIds: string[]; missingFactPersonIds: string[] } & MutationResult> {
		await this.runner.requireAccess(treeId, context, 'record:create');
		const { commands, skippedPersonIds, missingFactPersonIds } = await this.citeManyPlan(
			treeId,
			sourceId,
			personIds,
			citation,
			factType,
			context
		);
		if (commands.length === 0)
			return { skippedPersonIds, missingFactPersonIds, change: null, affected: [] };
		const result = await this.runner.run(treeId, context, {
			kind: 'cite_people',
			summary: (rows) => describeGroupCitation(rows, sourceId, commands.length, factType),
			commands
		});
		return { skippedPersonIds, missingFactPersonIds, ...result };
	}

	/** What `citeMany` would write, without writing it. */
	async previewMany(
		treeId: string,
		sourceId: string,
		personIds: string[],
		citation: CitationInput,
		factType: string | undefined,
		context: AuthenticatedContext
	): Promise<ImpactSummary> {
		await this.runner.requireAccess(treeId, context, 'record:create');
		const { commands } = await this.citeManyPlan(
			treeId,
			sourceId,
			personIds,
			citation,
			factType,
			context
		);
		return this.runner.preview(treeId, context, commands, (rows) =>
			describeGroupCitation(rows, sourceId, commands.length, factType)
		);
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
