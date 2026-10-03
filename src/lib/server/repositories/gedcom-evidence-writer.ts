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
import {
	citationRow,
	repositoryRow,
	sourceRepositoryRow,
	sourceRow,
	storedCitationKey
} from '../gedcom/evidence-rows';
import { chunkByParamLimit } from './param-chunks';

/** Columns Drizzle writes for each table; an insert is chunked by it under D1's parameter cap. */
const SOURCE_COLUMNS = 15;
const REPOSITORY_COLUMNS = 12;
const SOURCE_REPOSITORY_COLUMNS = 10;
const CITATION_COLUMNS = 22;

/** The citations a parsed structure carries, and the stored row they belong to. */
export interface CitationTarget {
	kind: CitationSubjectKind;
	id: string;
	citations: ParsedCitation[];
}

type SourceLookup = (pointer: string | undefined) => string | null;

/** Insert the file's repositories and sources; answers how a pointer to a source resolves. */
export async function importRecords(
	db: DbClient,
	treeId: string,
	parsed: ParsedGedcomData
): Promise<SourceLookup> {
	const importedAt = new Date();
	const repositoryIds = new Map<string, string>();
	for (const row of await db
		.select({ id: repositories.id, xref: repositories.xref, aliases: repositories.xrefAliases })
		.from(repositories)
		.where(eq(repositories.treeId, treeId))
		.all()) {
		if (row.xref) repositoryIds.set(row.xref, row.id);
		for (const alias of row.aliases ?? []) repositoryIds.set(alias, row.id);
	}
	const sourceIds = new Map<string, string>();
	for (const row of await db
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
		await db.insert(repositories).values(chunk).onConflictDoNothing();
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
		await db.insert(sources).values(chunk).onConflictDoNothing();
	}
	for (const chunk of chunkByParamLimit(linkRows, SOURCE_REPOSITORY_COLUMNS)) {
		await db.insert(sourceRepositories).values(chunk).onConflictDoNothing();
	}

	return (pointer) => (pointer ? (sourceIds.get(pointer) ?? null) : null);
}

/**
 * Insert citations for the stored rows they belong to, in file order after whatever the subject
 * already has, skipping any it already says.
 */
export async function importCitations(
	db: DbClient,
	treeId: string,
	targets: CitationTarget[],
	sourceOf: SourceLookup
): Promise<void> {
	if (targets.every((t) => t.citations.length === 0)) return;
	const importedAt = new Date();
	const known = new Map<string, { keys: Set<string>; next: number }>();
	for (const row of await db
		.select({
			kind: citations.subjectKind,
			subjectId: citations.subjectId,
			sortOrder: citations.sortOrder,
			sourceId: citations.sourceId,
			sourceRef: citations.sourceRef,
			description: citations.description,
			page: citations.page,
			text: citations.text
		})
		.from(citations)
		.where(eq(citations.treeId, treeId))
		.all()) {
		const entry = known.get(`${row.kind}|${row.subjectId}`) ?? { keys: new Set(), next: 0 };
		entry.keys.add(storedCitationKey(row));
		entry.next = Math.max(entry.next, row.sortOrder + 1);
		known.set(`${row.kind}|${row.subjectId}`, entry);
	}

	const rows: Array<ReturnType<typeof citationRow>> = [];
	for (const target of targets) {
		const slot = `${target.kind}|${target.id}`;
		const entry = known.get(slot) ?? { keys: new Set<string>(), next: 0 };
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
			if (entry.keys.has(key)) continue;
			entry.keys.add(key);
			rows.push(
				citationRow(
					treeId,
					crypto.randomUUID(),
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
		await db.insert(citations).values(chunk).onConflictDoNothing();
	}
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
