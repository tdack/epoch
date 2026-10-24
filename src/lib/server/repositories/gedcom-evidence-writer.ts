/**
 * Persists a parsed file's sources, repositories and citations (ADR-028).
 *
 * Identity on a merge-mode import: a source or repository is the same record when its XREF, or an
 * alias it was merged under, is already in the tree; a citation is the same when its subject, source,
 * inline text, page and text are. Nothing already stored is changed, so importing a file twice
 * writes it once.
 */

import { eq } from 'drizzle-orm';
import type { DbClient } from '../db';
import { citations, repositories, sourceRepositories, sources } from '../db/schema';
import { CITATION_SUBJECT_KINDS, type CitationSubjectKind } from '../../shared/evidence';
import { treeScopedId } from '../gedcom/import-preview';
import type { ParsedCitation, ParsedGedcomData } from '../gedcom/parser';
import type { ParsedNoteLink } from '../gedcom/note-parse';
import { NOTE_SUBJECT_KINDS } from '../../shared/notes';
import type { NoteTarget } from './gedcom-note-writer';
import {
	citationRow,
	repositoryRow,
	sourceRepositoryRow,
	sourceRow,
	storedCitationKey
} from '../gedcom/evidence-rows';
import { chunkByParamLimit } from './param-chunks';
import type { ImportBatch } from './import-batch';

/** Columns Drizzle writes for each table; an insert is chunked by it under D1's parameter cap. */
const SOURCE_COLUMNS = 15;
const REPOSITORY_COLUMNS = 12;
const SOURCE_REPOSITORY_COLUMNS = 11;
const CITATION_COLUMNS = 22;

/** The citations a parsed structure carries, and the stored row they belong to. */
export interface CitationTarget {
	kind: CitationSubjectKind;
	id: string;
	citations: ParsedCitation[];
	/** The notes on the same subject; read by `importNoteAttachments`, not here. */
	notes?: ParsedNoteLink[];
}

type SourceLookup = (pointer: string | undefined) => string | null;

/**
 * Insert the file's repositories and sources. Answers how a pointer to a source resolves, and the
 * notes of every source and repository the file has, against the stored row that holds each (a
 * source a merge-mode import already had is the row its notes join).
 */
export async function importRecords(
	db: DbClient,
	treeId: string,
	parsed: ParsedGedcomData,
	{ writes, isTreeEmpty }: ImportBatch
): Promise<{ sourceOf: SourceLookup; noteTargets: NoteTarget[] }> {
	const importedAt = new Date();
	const repositoryIds = new Map<string, string>();
	for (const row of isTreeEmpty
		? []
		: await db
				.select({ id: repositories.id, xref: repositories.xref, aliases: repositories.xrefAliases })
				.from(repositories)
				.where(eq(repositories.treeId, treeId))
				.all()) {
		if (row.xref) repositoryIds.set(row.xref, row.id);
		for (const alias of row.aliases ?? []) repositoryIds.set(alias, row.id);
	}
	const sourceIds = new Map<string, string>();
	for (const row of isTreeEmpty
		? []
		: await db
				.select({ id: sources.id, xref: sources.xref, aliases: sources.xrefAliases })
				.from(sources)
				.where(eq(sources.treeId, treeId))
				.all()) {
		if (row.xref) sourceIds.set(row.xref, row.id);
		for (const alias of row.aliases ?? []) sourceIds.set(alias, row.id);
	}

	const repositoryRows: Array<ReturnType<typeof repositoryRow>> = [];
	for (const repository of parsed.repositories) {
		if (repositoryIds.has(repository.id)) continue;
		const id = treeScopedId(treeId, repository.id);
		repositoryIds.set(repository.id, id);
		repositoryRows.push(repositoryRow(treeId, id, repository, importedAt));
	}
	for (const chunk of chunkByParamLimit(repositoryRows, REPOSITORY_COLUMNS)) {
		writes.push(db.insert(repositories).values(chunk).onConflictDoNothing());
	}

	const sourceRows: Array<ReturnType<typeof sourceRow>> = [];
	const linkRows: Array<ReturnType<typeof sourceRepositoryRow>> = [];
	for (const source of parsed.sources) {
		if (sourceIds.has(source.id)) continue;
		const id = treeScopedId(treeId, source.id);
		sourceIds.set(source.id, id);
		sourceRows.push(sourceRow(treeId, id, source, importedAt));
		source.repositories.forEach((link, index) =>
			linkRows.push(
				sourceRepositoryRow(
					crypto.randomUUID(),
					treeId,
					id,
					link,
					link.pointer ? (repositoryIds.get(link.pointer) ?? null) : null,
					index,
					importedAt
				)
			)
		);
	}
	for (const chunk of chunkByParamLimit(sourceRows, SOURCE_COLUMNS)) {
		writes.push(db.insert(sources).values(chunk).onConflictDoNothing());
	}
	for (const chunk of chunkByParamLimit(linkRows, SOURCE_REPOSITORY_COLUMNS)) {
		writes.push(db.insert(sourceRepositories).values(chunk).onConflictDoNothing());
	}

	const noteTargets: NoteTarget[] = [
		...parsed.repositories.map((r) => ({
			kind: NOTE_SUBJECT_KINDS.REPOSITORY,
			id: repositoryIds.get(r.id)!,
			notes: r.notes
		})),
		...parsed.sources.map((s) => ({
			kind: NOTE_SUBJECT_KINDS.SOURCE,
			id: sourceIds.get(s.id)!,
			notes: s.notes
		}))
	];
	return {
		sourceOf: (pointer) => (pointer ? (sourceIds.get(pointer) ?? null) : null),
		noteTargets
	};
}

/**
 * Insert citations for the stored rows they belong to, in file order after whatever the subject
 * already has, skipping any it already says.
 */
export async function importCitations(
	db: DbClient,
	treeId: string,
	targets: CitationTarget[],
	sourceOf: SourceLookup,
	{ writes, isTreeEmpty }: ImportBatch
): Promise<NoteTarget[]> {
	if (targets.every((t) => t.citations.length === 0)) return [];
	const importedAt = new Date();
	const known = new Map<string, { keys: Map<string, string>; next: number }>();
	for (const row of isTreeEmpty
		? []
		: await db
				.select({
					kind: citations.subjectKind,
					subjectId: citations.subjectId,
					sortOrder: citations.sortOrder,
					sourceId: citations.sourceId,
					sourceRef: citations.sourceRef,
					description: citations.description,
					page: citations.page,
					text: citations.text,
					id: citations.id
				})
				.from(citations)
				.where(eq(citations.treeId, treeId))
				.all()) {
		const entry = known.get(`${row.kind}|${row.subjectId}`) ?? { keys: new Map(), next: 0 };
		entry.keys.set(storedCitationKey(row), row.id);
		entry.next = Math.max(entry.next, row.sortOrder + 1);
		known.set(`${row.kind}|${row.subjectId}`, entry);
	}

	const rows: Array<ReturnType<typeof citationRow>> = [];
	// What each citation the file has says about itself, against the stored row that holds it.
	const noteTargets: NoteTarget[] = [];
	for (const target of targets) {
		const slot = `${target.kind}|${target.id}`;
		const entry = known.get(slot) ?? { keys: new Map<string, string>(), next: 0 };
		known.set(slot, entry);
		for (const citation of target.citations) {
			const sourceId = sourceOf(citation.pointer);
			const key = storedCitationKey({
				sourceId,
				sourceRef: sourceId === null ? (citation.pointer ?? null) : null,
				description: citation.description ?? null,
				page: citation.page ?? null,
				text: citation.text ?? null
			});
			const storedId = entry.keys.get(key);
			if (storedId) {
				noteTargets.push({
					kind: NOTE_SUBJECT_KINDS.CITATION,
					id: storedId,
					notes: citation.notes
				});
				continue;
			}
			const id = crypto.randomUUID();
			entry.keys.set(key, id);
			noteTargets.push({ kind: NOTE_SUBJECT_KINDS.CITATION, id, notes: citation.notes });
			rows.push(
				citationRow(
					treeId,
					id,
					{ kind: target.kind, id: target.id },
					citation,
					sourceId,
					entry.next++,
					importedAt
				)
			);
		}
	}
	for (const chunk of chunkByParamLimit(rows, CITATION_COLUMNS)) {
		writes.push(db.insert(citations).values(chunk).onConflictDoNothing());
	}
	return noteTargets;
}

/** The citation targets a file's people, partnerships and names add up to, before facts and links. */
export function recordTargets(
	parsed: ParsedGedcomData,
	scoped: (xref: string) => string
): CitationTarget[] {
	return [
		...parsed.individuals.map((ind) => ({
			kind: CITATION_SUBJECT_KINDS.PERSON,
			id: scoped(ind.id),
			citations: ind.citations
		})),
		...parsed.families.map((fam) => ({
			kind: CITATION_SUBJECT_KINDS.UNION,
			id: scoped(fam.id),
			citations: fam.citations
		}))
	];
}
