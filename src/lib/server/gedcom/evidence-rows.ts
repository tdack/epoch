/**
 * Parsed evidence as the rows that store it (ADR-028). The import and the backfill both build their
 * rows here, so a tree backfilled from retained lines and the same file imported fresh hold the
 * same records.
 */

import type { citations, repositories, sourceRepositories, sources } from '../db/schema';
import { dateColumnsFor } from '../domain/date-columns';
import type { CitationSubjectKind } from '../../shared/evidence';
import {
	citationIdentity,
	type ParsedCitation,
	type ParsedRepository,
	type ParsedSource,
	type ParsedSourceRepository
} from './evidence-parse';

type SourceInsert = typeof sources.$inferInsert;
type RepositoryInsert = typeof repositories.$inferInsert;
type SourceRepositoryInsert = typeof sourceRepositories.$inferInsert;
type CitationInsert = typeof citations.$inferInsert;

const orNull = <T>(value: T | undefined): T | null => value ?? null;
const keptOrNull = (lines: string[] | undefined) => (lines && lines.length > 0 ? lines : null);

export function sourceRow(
	treeId: string,
	id: string,
	parsed: ParsedSource,
	createdAt: Date
): SourceInsert {
	return {
		id,
		treeId,
		xref: parsed.id,
		title: orNull(parsed.title),
		author: orNull(parsed.author),
		publication: orNull(parsed.publication),
		abbreviation: orNull(parsed.abbreviation),
		text: orNull(parsed.text),
		gedcomExtra: keptOrNull(parsed.extra),
		gedcomLayout: parsed.layout ?? null,
		createdAt,
		updatedAt: createdAt
	};
}

export function repositoryRow(
	treeId: string,
	id: string,
	parsed: ParsedRepository,
	createdAt: Date
): RepositoryInsert {
	return {
		id,
		treeId,
		xref: parsed.id,
		name: orNull(parsed.name),
		address: orNull(parsed.address),
		gedcomExtra: keptOrNull(parsed.extra),
		gedcomLayout: parsed.layout ?? null,
		createdAt,
		updatedAt: createdAt
	};
}

/**
 * A `REPO` link of a source. `repositoryId` is the stored repository its pointer resolves to; a
 * pointer that resolves to nothing is kept as `repositoryRef` so export writes it back.
 */
export function sourceRepositoryRow(
	id: string,
	treeId: string,
	sourceId: string,
	link: ParsedSourceRepository,
	repositoryId: string | null,
	sortOrder: number,
	createdAt: Date
): SourceRepositoryInsert {
	return {
		id,
		treeId,
		sourceId,
		repositoryId,
		repositoryRef: repositoryId === null ? orNull(link.pointer) : null,
		callNumber: orNull(link.callNumber),
		gedcomExtra: keptOrNull(link.extra),
		sortOrder,
		createdAt,
		updatedAt: createdAt
	};
}

export interface CitationSubject {
	kind: CitationSubjectKind;
	id: string;
}

/**
 * A citation row. `sourceId` is the stored source the pointer resolves to; a pointer that resolves to
 * nothing is kept as `sourceRef`, so a citation of a record the file lacks is still written back.
 */
export function citationRow(
	treeId: string,
	id: string,
	subject: CitationSubject,
	parsed: ParsedCitation,
	sourceId: string | null,
	sortOrder: number,
	createdAt: Date
): CitationInsert & CitationIdentityColumns {
	const entryDate = parsed.entryDate ? dateColumnsFor(parsed.entryDate) : null;
	return {
		id,
		treeId,
		subjectKind: subject.kind,
		subjectId: subject.id,
		sortOrder,
		sourceId,
		sourceRef: sourceId === null ? orNull(parsed.pointer) : null,
		description: orNull(parsed.description),
		page: orNull(parsed.page),
		quality: orNull(parsed.quality),
		entryDateRaw: orNull(parsed.entryDate),
		entryDateSort: entryDate?.dateSort ?? null,
		entryDateSortEnd: entryDate?.dateSortEnd ?? null,
		entryDateQualifier: entryDate?.dateQualifier ?? null,
		entryDatePrecision: entryDate?.datePrecision ?? null,
		entryDateCalendar: entryDate?.dateCalendar ?? null,
		text: orNull(parsed.text),
		gedcomExtra: keptOrNull(parsed.extra),
		gedcomLayout: parsed.layout ?? null,
		createdAt,
		updatedAt: createdAt
	};
}

// A type, not an interface: the backfill passes a row where a `Record<string, unknown>` is wanted.
type CitationIdentityColumns = {
	sourceId: string | null;
	sourceRef: string | null;
	description: string | null;
	page: string | null;
	quality: number | null;
	entryDateRaw: string | null;
	text: string | null;
	gedcomExtra: string[] | null;
};

/**
 * What makes two citations of one subject the same on a merge-mode import: the source (by id, or by
 * the pointer it could not resolve), the inline text, the page, the quality, the entry date as
 * written, the text and the retained lines. Keyed through `citationIdentity`, as parsed citations
 * are, so the import's own rows match what it later reads back.
 */
export function storedCitationKey(c: CitationIdentityColumns): string {
	return citationIdentity({
		...c,
		source: c.sourceId ?? c.sourceRef,
		entryDate: c.entryDateRaw,
		extra: c.gedcomExtra
	});
}
