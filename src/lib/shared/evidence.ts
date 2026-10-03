/**
 * The vocabulary of sources, repositories and citations (ADR-028), shared by the server and the
 * screens so a label or a subject kind has one spelling.
 */

/** What a citation supports. A citation is owned by exactly one of these, never shared. */
export const CITATION_SUBJECT_KINDS = {
	PERSON: 'person',
	NAME: 'name',
	EVENT: 'event',
	UNION: 'union',
	PARENT_CHILD: 'parent_child'
} as const;
export type CitationSubjectKind =
	(typeof CITATION_SUBJECT_KINDS)[keyof typeof CITATION_SUBJECT_KINDS];

export const CITATION_SUBJECT_KIND_VALUES = [
	CITATION_SUBJECT_KINDS.PERSON,
	CITATION_SUBJECT_KINDS.NAME,
	CITATION_SUBJECT_KINDS.EVENT,
	CITATION_SUBJECT_KINDS.UNION,
	CITATION_SUBJECT_KINDS.PARENT_CHILD
] as const;

/** GEDCOM `QUAY`, worded for people. The number is what is stored and written; the words are what is shown. */
export const CITATION_QUALITY_LABELS = {
	0: 'Unreliable, or estimated from other data',
	1: 'Questionable',
	2: 'Secondary evidence',
	3: 'Direct, primary evidence'
} as const;
export type CitationQuality = keyof typeof CITATION_QUALITY_LABELS;

export function isCitationQuality(value: unknown): value is CitationQuality {
	return value === 0 || value === 1 || value === 2 || value === 3;
}

/** The facts a researcher is expected to be able to source; an unsourced one earns a suggestion (ADR-028). */
export const KEY_FACT_TYPES = ['BIRT', 'DEAT', 'MARR'] as const;

/** A claim's evidence state, in words, so colour is never the only signal. */
export const CLAIM_STATES = {
	SOURCED: 'sourced',
	UNSOURCED: 'unsourced',
	CONFLICTING: 'conflicting'
} as const;
export type ClaimState = (typeof CLAIM_STATES)[keyof typeof CLAIM_STATES];

export const CLAIM_STATE_LABELS: Record<ClaimState, string> = {
	sourced: 'Sourced',
	unsourced: 'Unsourced',
	conflicting: 'Conflicting'
};

/** The most a source or repository page lists in one response. */
export const MAX_EVIDENCE_PAGE_SIZE = 100;
export const DEFAULT_EVIDENCE_PAGE_SIZE = 25;
