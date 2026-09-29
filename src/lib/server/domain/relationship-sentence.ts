/**
 * Human-readable relationship "graph sentences".
 *
 * Phase 2 begins every mutation from intent and shows the resulting graph as a
 * sentence before saving, e.g. "Alex Walker will be recorded as Sam's adoptive
 * mother in the Alex Walker–Jordan Lee family." These functions are pure and
 * produce that sentence from the intent, keeping relationship type, parent role
 * and sex/gender separate.
 */

import type { ParentChildType } from './genealogy-model';
import type { EndedUnionStatus, UnionEventType } from '../../shared/union-events';

export interface PersonRef {
	id: string;
	givenName: string | null;
	surname: string | null;
	/** True for someone the intent creates; `id` is then a placeholder the server replaces. */
	isNew?: boolean;
}

export type ParentRole = 'parent' | 'mother' | 'father';

export type RelationshipIntent =
	| {
			kind: 'add_parent';
			child: PersonRef;
			parent: PersonRef;
			type: ParentChildType;
			role: ParentRole;
			unionLabel: string | null;
			/** The parental group the parent joins. Undefined: the server picks the fullest. Null: none. */
			unionId?: string | null;
	  }
	| {
			kind: 'add_child';
			parent: PersonRef;
			child: PersonRef;
			type: ParentChildType;
			unionLabel: string | null;
			/** The partnership the child joins. Undefined: the server picks the fullest. Null: none. */
			unionId?: string | null;
	  }
	| {
			kind: 'add_partner';
			person: PersonRef;
			partner: PersonRef;
			unionLabel: string | null;
			/** The one-partner partnership to fill. Undefined: the fullest one, else a new one. Null: a new one. */
			unionId?: string | null;
	  }
	| {
			kind: 'record_death';
			person: PersonRef;
			/** Death date as typed; kept verbatim. */
			dateText: string | null;
			place: string | null;
			/** The person's version the form was loaded from, so a concurrent edit is caught. */
			personVersion?: number;
	  }
	| {
			kind: 'end_union';
			person: PersonRef;
			/** The partnership to end. Null only when the person has exactly one; the planner resolves it. */
			unionId: string | null;
			status: EndedUnionStatus;
			event: { type: UnionEventType; dateText: string | null; place: string | null } | null;
			unionVersion?: number;
	  };

/**
 * Facts the server resolves and the sentence needs but the client cannot be trusted to supply:
 * which family a link will land in, who is in the partnership, and who becomes widowed.
 */
export interface SentenceFacts {
	/** What follows "in the": "Homer Simpson–Marge Simpson family" or "2nd partnership of Homer Simpson and Marge Simpson". */
	unionPhrase?: string | null;
	partners?: PersonRef[];
	widowed?: Array<{ widow: PersonRef; deceased: PersonRef }>;
}

const RELATIONSHIP_TYPE_LABEL: Record<ParentChildType, string> = {
	biological: 'biological',
	adoptive: 'adoptive',
	foster: 'foster',
	guardian: 'guardian',
	unknown: ''
};

const ROLE_LABEL: Record<ParentRole, string> = {
	parent: 'parent',
	mother: 'mother',
	father: 'father'
};

/** "Alex Walker" when a surname exists, otherwise just the given name. */
export function displayName(person: PersonRef): string {
	const given = person.givenName?.trim();
	const surname = person.surname?.trim();
	if (given && surname) return `${given} ${surname}`;
	return given || surname || 'Unknown';
}

function possessive(name: string): string {
	return name.endsWith('s') ? `${name}'` : `${name}'s`;
}

function describeParentRole(type: ParentChildType, role: ParentRole): string {
	const label = RELATIONSHIP_TYPE_LABEL[type];
	return label ? `${label} ${ROLE_LABEL[role]}` : ROLE_LABEL[role];
}

function unionSuffix(unionPhrase: string | null): string {
	return unionPhrase ? ` in the ${unionPhrase}` : '';
}

/** "3 Mar 2001, Brisbane": whatever of the date and place was given. */
function details(dateText: string | null, place: string | null): string {
	return [dateText?.trim(), place?.trim()].filter(Boolean).join(', ');
}

const ENDED_STATUS_WORD: Record<EndedUnionStatus, string> = {
	separated: 'separated',
	divorced: 'divorced',
	annulled: 'annulled',
	ended: 'ended'
};

/**
 * Produce the graph sentence preview for a relationship intent. `facts` carries what the server
 * resolved, so the sentence describes what will actually be saved rather than what was asked for.
 */
export function describeRelationshipIntent(intent: RelationshipIntent, facts: SentenceFacts = {}): string {
	const clientLabel = 'unionLabel' in intent && intent.unionLabel ? `${intent.unionLabel} family` : null;
	const unionLabel = facts.unionPhrase ?? clientLabel;
	switch (intent.kind) {
		case 'add_parent':
			return `${displayName(intent.parent)} will be recorded as ${possessive(
				displayName(intent.child)
			)} ${describeParentRole(intent.type, intent.role)}${unionSuffix(unionLabel)}.`;

		case 'add_child':
			return `${displayName(intent.child)} will be recorded as ${possessive(
				displayName(intent.parent)
			)} ${RELATIONSHIP_TYPE_LABEL[intent.type] || ''} child${unionSuffix(unionLabel)}.`.replace(
				/\s{2,}/g,
				' '
			);

		case 'add_partner':
			return `${displayName(intent.partner)} will be recorded as ${possessive(
				displayName(intent.person)
			)} partner${unionSuffix(unionLabel)}.`;

		case 'record_death': {
			const extra = details(intent.dateText, intent.place);
			const base = `${displayName(intent.person)} will be recorded as deceased${extra ? ` (${extra})` : ''}.`;
			// "their" rather than a guessed pronoun: the record holds sex, not how someone is referred to.
			const widowed = (facts.widowed ?? []).map(
				({ widow, deceased }) =>
					`${displayName(widow)} will be shown as widowed in their partnership with ${displayName(deceased)}.`
			);
			return [base, ...new Set(widowed)].join(' ');
		}

		case 'end_union': {
			const partners = facts.partners ?? [];
			const who =
				partners.length >= 2
					? `The partnership between ${partners.map(displayName).join(' and ')}`
					: partners.length === 1
						? `${possessive(displayName(partners[0]))} partnership`
						: 'The partnership';
			const extra = intent.event ? details(intent.event.dateText, intent.event.place) : '';
			return `${who} will be recorded as ${ENDED_STATUS_WORD[intent.status]}${extra ? ` (${extra})` : ''}.`;
		}
	}
}
