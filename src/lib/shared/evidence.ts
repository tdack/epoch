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

/**
 * The facts a researcher is expected to be able to source: a person's birth and death and a
 * partnership's marriage. An uncited one earns a research suggestion, never a warning (ADR-028).
 */
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

/** The fields a source is made and edited with. A missing field on an edit is left as it is. */
export interface SourceInput {
	title?: string | null;
	author?: string | null;
	publication?: string | null;
	abbreviation?: string | null;
	/** The words of the source itself, as GEDCOM's source `TEXT`. */
	text?: string | null;
}

export interface RepositoryInput {
	name?: string | null;
	address?: string | null;
}

/** The fields a citation is made and edited with. */
export interface CitationInput {
	/** The source cited. A citation always has one when made here. */
	sourceId?: string | null;
	/** Where in the source: a page, a folio, an entry number. */
	page?: string | null;
	/** GEDCOM `QUAY`; null clears it. */
	quality?: CitationQuality | null;
	/** When the source recorded it, as date text (`ABT 1901`). */
	entryDate?: string | null;
	/** The words of the source that support the claim. */
	text?: string | null;
}

export interface CitationSubjectRef {
	kind: CitationSubjectKind;
	id: string;
}

/**
 * The most rows one evidence change writes. D1 counts each statement of a batch as a query with
 * 1,000 allowed per invocation, and a row costs a version guard, a write and its log record
 * (ADR-022 sets the same bound for a person merge). A change over it is refused, not half made.
 */
export const MAX_EVIDENCE_OPS = 300;

/** A source's title, else its abbreviation or the start of its words; never empty. */
export function sourceLabel(source: {
	title: string | null;
	abbreviation: string | null;
	text: string | null;
}): string {
	const text = source.text
		? `${source.text.slice(0, 40)}${source.text.length > 40 ? '…' : ''}`
		: null;
	return source.title || source.abbreviation || text || 'Untitled source';
}

// ---- What the pages read ----

/** One citation as the pages show it. */
export interface CitationDto {
	id: string;
	/** Send this back when editing; a newer stored version is a conflict. */
	version: number;
	sortOrder: number;
	subject: CitationSubjectRef;
	/** Null for a citation with no source record (inline text, or a pointer the file did not resolve). */
	sourceId: string | null;
	/** The source's title, or the words the citation carries instead. */
	sourceLabel: string;
	page: string | null;
	quality: CitationQuality | null;
	/** `DATA.DATE` as written. */
	entryDate: string | null;
	text: string | null;
}

/** What the person page lists as a person's evidence: every citation of them and of what they have. */
export interface PersonEvidenceDto {
	/** In the order each record's own are kept; the page groups them by `subject`. */
	citations: CitationDto[];
	/** The parent links the person is in, named, so a citation of one reads as something. */
	links: Array<{ id: string; label: string }>;
}

/** The evidence on a partnership page: the partnership, its facts and the links shown there. */
export interface UnionEvidenceDto {
	citations: CitationDto[];
	links: Array<{ id: string; label: string }>;
}

export interface SourceListItem {
	id: string;
	xref: string | null;
	title: string | null;
	author: string | null;
	abbreviation: string | null;
	/** Citations the viewer may see. */
	citationCount: number;
}

export interface RepositoryListItem {
	id: string;
	/** Send this back when editing; a newer stored version is a conflict. */
	version: number;
	name: string | null;
	address: string | null;
	sourceCount: number;
}

/** A source's place in a repository. */
export interface SourceRepositoryDto {
	linkId: string;
	version: number;
	repositoryId: string | null;
	/** The repository's name; the pointer the file named when there is no record for it. */
	name: string;
	address: string | null;
	callNumber: string | null;
}

/** The citations of a source that support one record, for the source's page. */
export interface SourceCitationGroup {
	subject: CitationSubjectRef;
	/** "Ann Ash", "the birth of Ann Ash", "the partnership of Ann Ash and Bob Ash". */
	label: string;
	/** Where the group links to: the person or the partnership it is about. */
	personId: string | null;
	unionId: string | null;
	citations: CitationDto[];
}

export interface SourceDto {
	id: string;
	xref: string | null;
	version: number;
	title: string | null;
	author: string | null;
	publication: string | null;
	abbreviation: string | null;
	text: string | null;
	repositories: SourceRepositoryDto[];
	/** Citations of this source the viewer may see, all pages. */
	citationCount: number;
	groups: SourceCitationGroup[];
	hasMore: boolean;
	offset: number;
	limit: number;
}

/** The claim state of a fact or name, from its citations and whether another fact disagrees (ADR-028). */
export function claimStateOf(options: {
	citationCount: number;
	isConflicting: boolean;
}): ClaimState {
	if (options.isConflicting) return CLAIM_STATES.CONFLICTING;
	return options.citationCount > 0 ? CLAIM_STATES.SOURCED : CLAIM_STATES.UNSOURCED;
}
