/**
 * What the partnership page reads, as the API answers it. The service that builds it stays on the
 * server; only the shapes live here.
 */

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
	changes: { recent: ChangeEntryDto[]; createdAt: number | null; updatedAt: number | null };
	/** The window around the first partner, for the editing dialogs. */
	graph: RelationshipGraph;
}
