/**
 * What the partnership page reads, as the API answers it. The service that builds it stays on the
 * server; only the shapes live here.
 */

import type { UnionEvidenceDto } from './evidence';
import type { NoteDto } from './notes';
import type { PartnershipLabel } from './partnership-labels';
import type { PersonSummaryDto, ChangeEntryDto } from './person-page';
import type { PrivacyFlag } from './privacy';
import type { RelationshipGraph } from './relationship-graph';
import type { ParentChildType, UnionStatus } from './relationship-model';
import type { UnionWarning } from './union-warnings';

export interface UnionEventDto extends PrivacyFlag {
	id: string;
	type: string;
	label: string;
	dateText: string | null;
	sortStart: string | null;
	place: string | null;
	/** The note or imported description on the event. */
	notes: string | null;
	/** The union editor can change events of this type; others (a census, say) are shown as recorded. */
	isEditable: boolean;
	version: number;
	/** How many citations support this fact; 0 is unsourced (ADR-028). */
	citationCount: number;
	/** Every note on the event, in order, inline or shared (ADR-029). */
	noteItems: NoteDto[];
}

export const CHRONOLOGY_KINDS = {
	UNION_EVENT: 'union_event',
	PARTNER_BIRTH: 'partner_birth',
	PARTNER_DEATH: 'partner_death',
	CHILD_BIRTH: 'child_birth'
} as const;

export type ChronologyKind = (typeof CHRONOLOGY_KINDS)[keyof typeof CHRONOLOGY_KINDS];

export interface ChronologyEntryDto {
	kind: ChronologyKind;
	label: string;
	dateText: string | null;
	sortStart: string | null;
	/** The person the entry is about, or null for the partnership's own events. */
	personId: string | null;
}

export interface UnionChildDto {
	person: PersonSummaryDto;
	/** One entry per parent link, so a child adopted by one partner reads as such. */
	links: Array<{ parentId: string; parentName: string; type: ParentChildType }>;
}

export interface UnionPageDto extends PrivacyFlag {
	union: {
		id: string;
		version: number;
		status: UnionStatus;
		label: PartnershipLabel | null;
		/** XREFs of partnerships merged into this one (ADR-008). */
		xrefAliases: string[];
	};
	partners: PersonSummaryDto[];
	events: UnionEventDto[];
	children: UnionChildDto[];
	/** Events and vitals in date order, undated last. */
	chronology: ChronologyEntryDto[];
	warnings: UnionWarning[];
	/** Other partnerships with exactly the same partners. */
	twins: Array<{ unionId: string; label: PartnershipLabel | null }>;
	/** Citations of the partnership, its facts and the parent links shown above. */
	evidence: UnionEvidenceDto;
	/** The notes on the partnership itself, in order (ADR-029). */
	notes: NoteDto[];
	/** The notes on the parent links filed under it, each named by parent and child. */
	linkNotes: Array<{ id: string; label: string; notes: NoteDto[] }>;
	changes: { recent: ChangeEntryDto[]; createdAt: number | null; updatedAt: number | null };
	/** The window around the first partner, for the editing dialogs. */
	graph: RelationshipGraph;
}

/** A vital fact as a group sheet prints it: the date as stored, and where. */
export interface GroupSheetVitalDto {
	type: string;
	label: string;
	dateText: string | null;
	place: string | null;
}

/**
 * The partnership page plus what a family group sheet adds. Keyed by person id, and only for people
 * the page shows by name: a placeholder has no entry.
 */
export interface GroupSheetDto {
	page: UnionPageDto;
	vitals: Record<string, GroupSheetVitalDto[]>;
	/** Each partner's own parents, with the kind of link (adoptive, foster, …). */
	parents: Record<string, Array<{ person: PersonSummaryDto; type: ParentChildType }>>;
	/** Each child's partners, one entry per partnership. */
	partnersOfChildren: Record<string, Array<{ unionId: string; person: PersonSummaryDto }>>;
}
