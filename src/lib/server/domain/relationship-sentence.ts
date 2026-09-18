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

export interface PersonRef {
	id: string;
	givenName: string | null;
	surname: string | null;
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
	  }
	| {
			kind: 'add_child';
			parent: PersonRef;
			child: PersonRef;
			type: ParentChildType;
			unionLabel: string | null;
	  }
	| {
			kind: 'add_partner';
			person: PersonRef;
			partner: PersonRef;
			unionLabel: string | null;
	  }
	| {
			kind: 'record_death';
			person: PersonRef;
			/** Partners who would become widowed as a derived consequence. */
			widowedPartners: PersonRef[];
	  }
	| {
			kind: 'end_union';
			person: PersonRef;
			unionLabel: string;
	  };

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

function unionSuffix(unionLabel: string | null): string {
	return unionLabel ? ` in the ${unionLabel} family` : '';
}

/**
 * Produce the graph sentence preview for a relationship intent.
 */
export function describeRelationshipIntent(intent: RelationshipIntent): string {
	switch (intent.kind) {
		case 'add_parent':
			return `${displayName(intent.parent)} will be recorded as ${possessive(
				displayName(intent.child)
			)} ${describeParentRole(intent.type, intent.role)}${unionSuffix(intent.unionLabel)}.`;

		case 'add_child':
			return `${displayName(intent.child)} will be recorded as ${possessive(
				displayName(intent.parent)
			)} ${RELATIONSHIP_TYPE_LABEL[intent.type] || ''} child${unionSuffix(intent.unionLabel)}.`.replace(
				/\s{2,}/g,
				' '
			);

		case 'add_partner':
			return `${displayName(intent.partner)} will be recorded as ${possessive(
				displayName(intent.person)
			)} partner${unionSuffix(intent.unionLabel)}.`;

		case 'record_death': {
			const base = `${displayName(intent.person)} will be recorded as deceased.`;
			if (intent.widowedPartners.length === 0) return base;
			const names = intent.widowedPartners.map(displayName).join(' and ');
			return `${base} ${names} will become widowed.`;
		}

		case 'end_union':
			return `${displayName(intent.person)} will no longer be part of the ${intent.unionLabel} union.`;
	}
}
