import type { CitationDto, CitationSubjectKind } from '#lib/shared/evidence.js';

/** The citations of one record, from the list a page carries for everything it shows. */
export function citationsOfSubject(
	citations: readonly CitationDto[],
	kind: CitationSubjectKind,
	id: string
): CitationDto[] {
	return citations.filter((c) => c.subject.kind === kind && c.subject.id === id);
}
