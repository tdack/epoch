/** Citations as the pages show them (ADR-028): the row, with its source's words. Pure. */

import type { CitationRow, SourceRow } from '../domain/change-log';
import type { NoteDto } from '../../shared/notes';
import {
	sourceLabel,
	isCitationQuality,
	type CitationDto,
	type CitationSubjectKind
} from '../../shared/evidence';

/** What a citation says when it has no source record: its own words, or the pointer it could not resolve. */
function fallbackLabel(row: CitationRow): string {
	if (row.description) return row.description;
	return row.sourceRef ? `Source ${row.sourceRef} (not in this tree)` : 'Unknown source';
}

export function citationDto(
	row: CitationRow,
	sourcesById: ReadonlyMap<string, SourceRow>,
	notes: NoteDto[] = []
): CitationDto {
	const source = row.sourceId ? sourcesById.get(row.sourceId) : undefined;
	return {
		id: row.id,
		version: row.version,
		sortOrder: row.sortOrder,
		subject: { kind: row.subjectKind as CitationSubjectKind, id: row.subjectId },
		sourceId: source?.id ?? null,
		sourceLabel: source ? sourceLabel(source) : fallbackLabel(row),
		page: row.page,
		quality: isCitationQuality(row.quality) ? row.quality : null,
		entryDate: row.entryDateRaw,
		text: row.text,
		notes
	};
}

/** Each record's citations stay together and in the order they are kept. */
export function inSubjectOrder(rows: CitationRow[]): CitationRow[] {
	return [...rows].sort(
		(a, b) =>
			a.subjectKind.localeCompare(b.subjectKind) ||
			a.subjectId.localeCompare(b.subjectId) ||
			a.sortOrder - b.sortOrder
	);
}
