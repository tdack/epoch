/** What the report pages read, as the server answers them (reports plan, stages 6 to 9). */

import type { ChartPerson } from './charts';
import type { DescendantNumbering } from './descendant-numbers';
import type { NarrativeSentence } from './narrative';

export const NARRATIVE_KINDS = { ANCESTORS: 'ancestors', DESCENDANTS: 'descendants' } as const;
export type NarrativeKind = (typeof NARRATIVE_KINDS)[keyof typeof NARRATIVE_KINDS];

export function isNarrativeKind(value: unknown): value is NarrativeKind {
	return Object.values(NARRATIVE_KINDS).includes(value as NarrativeKind);
}

/** Generations a narrative tells, the person included: each is a page or more of prose. */
export const DEFAULT_NARRATIVE_GENERATIONS = 3;
export const MAX_NARRATIVE_GENERATIONS = 6;

/** What a family book can hold; the name index covers whichever narratives are ticked. */
export const BOOK_SECTIONS = {
	ANCESTORS: 'ancestors',
	DESCENDANTS: 'descendants',
	GAPS: 'gaps',
	INDEX: 'index'
} as const;
export type BookSection = (typeof BOOK_SECTIONS)[keyof typeof BOOK_SECTIONS];

export const BOOK_SECTION_LABELS: Record<BookSection, string> = {
	ancestors: 'Ancestors',
	descendants: 'Descendants',
	gaps: 'Research gaps',
	index: 'Index of names'
};

export interface NarrativeEntryDto {
	/** Ahnentafel for ancestors; d'Aboville or Henry for descendants. */
	number: string;
	/** 1 for the person the report is about. */
	generation: number;
	personId: string;
	name: string;
	/** A placeholder: no name and no sentences. */
	isPrivate: boolean;
	/** Set when this person already has an entry, which this one points to instead of repeating. */
	seeNumber: string | null;
	sentences: NarrativeSentence[];
}

export interface NarrativeDto {
	kind: NarrativeKind;
	person: ChartPerson;
	generations: number;
	/** More generations exist past the last one told. */
	hasMore: boolean;
	/** Null for ancestors, which are always Ahnentafel numbered. */
	numbering: DescendantNumbering | null;
	entries: NarrativeEntryDto[];
	endnotes: Array<{ number: number; text: string }>;
}
