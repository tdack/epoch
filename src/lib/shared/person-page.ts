/**
 * What the person page, the drawer and the record pages read about someone, as the API answers it.
 * The services that build these stay on the server; only the shapes live here.
 */

import type { PersonEvidenceDto } from './evidence';
import type { NoteDto } from './notes';
import type { PersonTasksDto } from './tasks';
import type { FactConflict } from './fact-timeline';
import type { FactKind } from './fact-types';
import type { NameType } from './name-types';
import type { PartnershipLabel } from './partnership-labels';
import type { PersonPrivacy, PrivacyFlag } from './privacy';
import type { GraphUnionEvent, RelationshipGraph } from './relationship-graph';
import type { ParentChildType, UnionStatus } from './relationship-model';
import type { Sex } from './sex';

export interface PersonSummaryDto extends PrivacyFlag {
	id: string;
	displayName: string;
	sex: Sex | null;
	birthDate: string | null;
	deathDate: string | null;
	isDeceased: boolean;
}

export interface FactDto extends PrivacyFlag {
	id: string;
	type: string;
	label: string;
	kind: FactKind;
	/** As typed or imported; never rewritten. */
	dateText: string | null;
	/** Inclusive lower bound, for ordering; null when undated or not a date. */
	sortStart: string | null;
	isApproximate: boolean;
	place: string | null;
	value: string | null;
	cause: string | null;
	age: string | null;
	/** Imported details (ADDR, TYPE, AGNC, RELI, contacts, coordinates); null when none. */
	address: string | null;
	classification: string | null;
	agency: string | null;
	phone: string | null;
	email: string | null;
	fax: string | null;
	web: string | null;
	latitude: string | null;
	longitude: string | null;
	religion: string | null;
	/**
	 * Lines the editor cannot show yet (e.g. RESN, OBJE, custom tags), verbatim as stored. They may
	 * contain pointers, so they are read-only and shown only with the rest of the fact.
	 */
	retainedLines: string[];
	/** The note, or the imported description on a fact nobody has edited since. */
	notes: string | null;
	/** True when `notes` is a legacy imported description (its real role was never recorded). */
	isLegacyNote: boolean;
	sortOrder: number;
	/** Send this back when editing; a newer stored version is a conflict. */
	version: number;
	/** Set when another fact of the same type disagrees with, or repeats, this one. */
	conflict: FactConflict | null;
	/** How many citations support this fact; 0 is unsourced (ADR-028). */
	citationCount: number;
	/** Every note on the fact, in order, inline or shared (ADR-029). */
	noteItems: NoteDto[];
}

export interface NameDto extends PrivacyFlag {
	/** Null for the name derived from the person's own name fields when none is stored. */
	id: string | null;
	/** Null with `id`: a derived name has nothing to conflict with. */
	version: number | null;
	type: NameType;
	/** The word of a free-text type, when the type is `other`. */
	gedcomType: string | null;
	givenName: string | null;
	surname: string | null;
	prefix: string | null;
	suffix: string | null;
	nickname: string | null;
	surnamePrefix: string | null;
	/** When the name came into use, as typed; the partnership it came from, if recorded. */
	dateText: string | null;
	unionId: string | null;
	displayName: string;
	isPreferred: boolean;
	/** How many citations support this name; 0 is unsourced. Always 0 for a derived name. */
	citationCount: number;
	/** The notes on the name; Epoch's own name-change note is not one (ADR-013, ADR-029). */
	notes: NoteDto[];
}

interface ParentFamilyDto {
	unionId: string | null;
	label: PartnershipLabel | null;
	parents: Array<{
		person: PersonSummaryDto;
		type: ParentChildType;
		/** The parent-child assertion, which a citation of the link is filed under. */
		linkId: string | null;
	}>;
}

export interface PartnershipDto extends PrivacyFlag {
	unionId: string;
	version: number;
	status: UnionStatus;
	label: PartnershipLabel | null;
	/** The person is a widow(er) in this partnership: it has not ended and a partner has died. */
	isWidowed: boolean;
	/** Another partnership has exactly the same partners, so the two can be merged. */
	isMergeable: boolean;
	partners: PersonSummaryDto[];
	children: Array<{ person: PersonSummaryDto; types: ParentChildType[] }>;
	events: GraphUnionEvent[];
}

interface MediaDto extends PrivacyFlag {
	id: string;
	title: string | null;
	mimeType: string;
	r2ObjectKey: string;
	/** Computed on the server: editors may delete the files they uploaded, managers any. */
	canDelete: boolean;
}

export interface ChangeEntryDto {
	id: string;
	kind: string;
	summary: string;
	actorName: string | null;
	/** Epoch milliseconds. */
	createdAt: number;
	isUndo: boolean;
}

interface PersonPrivacyDto {
	/** The manager's override: `auto` follows the dates. */
	setting: PersonPrivacy;
	/** What the dates alone say, so a manager sees why someone is hidden from viewers. */
	isLikelyLiving: boolean;
}

export interface PersonPageDto extends PrivacyFlag {
	/** Present only when the page was asked for through a sub-tree address: is the person a member of that lens. */
	isInSubtree?: boolean;
	/** Null for a viewer who may not change privacy; set for roles that see everyone. */
	privacy: PersonPrivacyDto | null;
	person: {
		id: string;
		xrefId: string | null;
		version: number;
		sex: Sex;
		givenName: string | null;
		surname: string | null;
		displayName: string;
		isDeceased: boolean;
	};
	names: NameDto[];
	vitals: {
		birth: FactDto | null;
		death: FactDto | null;
		lifespan: string | null;
		hasConflict: boolean;
	};
	/** Every fact, in timeline order. */
	facts: FactDto[];
	parentFamilies: ParentFamilyDto[];
	partnerships: PartnershipDto[];
	/** Children recorded with no partnership. */
	directChildren: Array<{ person: PersonSummaryDto; types: ParentChildType[] }>;
	siblings: { full: PersonSummaryDto[]; half: PersonSummaryDto[] };
	stepParents: Array<{ person: PersonSummaryDto; unionId: string }>;
	stepChildren: Array<{ person: PersonSummaryDto; via: PersonSummaryDto; unionId: string }>;
	media: MediaDto[];
	/** The notes on the person themself, in order (ADR-029). */
	notes: NoteDto[];
	/** The notes on the parent links the person is the child in, each link named by the parent. */
	linkNotes: Array<{ id: string; label: string; notes: NoteDto[] }>;
	evidence: PersonEvidenceDto;
	/** The research tasks about the person and their facts (ADR-029). */
	tasks: PersonTasksDto;
	changes: {
		/**
		 * Changes that wrote the person or a fact they still have. Changes to a fact that was later
		 * removed are not listed: the log finds a change by the record it wrote, and that record is
		 * gone. Phase 4's change view reads the log directly and has no such gap.
		 */
		recent: ChangeEntryDto[];
		/** Epoch milliseconds the person's row was created and last written. */
		createdAt: number | null;
		updatedAt: number | null;
	};
	/** The window the relatives came from, for the editing dialogs (partnerships, versions, labels). */
	graph: RelationshipGraph;
}
