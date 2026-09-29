/**
 * Phase 2 relationship commands: typed, intent-based mutations against the neutral model.
 * `planRelationshipCommand` expands a high-level intent into the concrete commands plus warnings
 * and the preview sentence; `tree-ops.ts` turns those commands into row operations.
 */

import { parseDateValue } from './date-value';
import type { ParentChildType, UnionStatus } from './genealogy-model';
import type { TreeRows } from './change-log';
import { validateParentChildAssertion } from './invariants';
import {
	describeRelationshipIntent,
	type PersonRef,
	type RelationshipIntent,
	type SentenceFacts
} from './relationship-sentence';
import { asParentChild, deceasedIdsOf, partnerIdsOf, unionIdsOf, personName } from './tree-ops';
import type { MergeChoices } from '../../shared/union-merge';
import { type EndedUnionStatus, type UnionEventInput, type UnionEventType } from '../../shared/union-events';
import { newWidowhoods } from '../../shared/widowhood';

export type RelationshipCommand =
	| {
			kind: 'create_person';
			personId: string;
			givenName: string | null;
			surname: string | null;
			sex: 'M' | 'F' | 'U';
			birthDate?: string | null;
			birthPlace?: string | null;
			deathDate?: string | null;
			deathPlace?: string | null;
	  }
	| {
			kind: 'update_person';
			personId: string;
			expectedVersion?: number;
			givenName?: string | null;
			surname?: string | null;
			sex?: 'M' | 'F' | 'U';
			birthDate?: string | null;
			birthPlace?: string | null;
			deathDate?: string | null;
			deathPlace?: string | null;
	  }
	| { kind: 'delete_person'; personId: string; expectedVersion?: number }
	| {
			kind: 'record_death';
			personId: string;
			dateText: string | null;
			place: string | null;
			expectedVersion?: number;
	  }
	| { kind: 'create_union'; unionId: string; personIds: string[]; status?: UnionStatus }
	| {
			kind: 'assert_parent_child';
			parentId: string;
			childId: string;
			type: ParentChildType;
			unionId: string | null;
	  }
	| { kind: 'add_partner_to_union'; unionId: string; personId: string }
	| { kind: 'remove_partner_from_union'; unionId: string; personId: string; expectedVersion?: number }
	| {
			kind: 'end_union';
			unionId: string;
			status: EndedUnionStatus;
			event: { type: UnionEventType; dateText: string | null; place: string | null } | null;
			expectedVersion?: number;
	  }
	| {
			kind: 'update_union';
			unionId: string;
			expectedVersion: number;
			status?: UnionStatus;
			/** The full set of editor-managed events the union should have afterwards. */
			events?: UnionEventInput[];
	  }
	| { kind: 'remove_parent_child'; parentId: string; childId: string; type: ParentChildType }
	| { kind: 'destroy_union'; unionId: string; expectedVersion?: number }
	| {
			kind: 'merge_unions';
			/** The union that remains; its XREF stays the primary one. */
			survivorId: string;
			/** The unions folded into it and deleted. */
			mergedIds: string[];
			/** Version each involved union was loaded at, keyed by union id. */
			expectedVersions?: Record<string, number>;
			/** Which union's value to keep wherever the unions disagree. */
			keep?: MergeChoices;
	  };

export interface PlanWarning {
	code:
		| 'DUPLICATE_PERSON'
		| 'MULTIPLE_UNIONS'
		| 'UNKNOWN_PARENT'
		| 'CYCLE'
		| 'NO_UNION'
		| 'ALREADY_PARTNERS'
		| 'ALREADY_DECEASED'
		| 'DEATH_BEFORE_BIRTH'
		| 'UNION_ALREADY_ENDED'
		| 'END_BEFORE_START';
	message: string;
}

export interface RelationshipPlan {
	/** Human-readable preview of the resulting graph. */
	sentence: string;
	commands: RelationshipCommand[];
	warnings: PlanWarning[];
}

export interface PlanContext {
	/** The tree as it is now; the plan reads it, never writes it. */
	rows: TreeRows;
	/** Whether a similarly named person already exists (duplicate cue). */
	hasDuplicateName: boolean;
	newId: () => string;
}

function partnerRefs(rows: TreeRows, unionId: string): PersonRef[] {
	return partnerIdsOf(rows, unionId).map((id) => refOf(rows, id));
}

function refOf(rows: TreeRows, id: string): PersonRef {
	const person = rows.individuals.find((p) => p.id === id);
	return { id, givenName: person?.givenName ?? null, surname: person?.surname ?? null };
}

/** "Homer Simpson–Marge Simpson": how a family is named in a sentence. */
export function unionLabelOf(rows: TreeRows, unionId: string): string | null {
	const names = partnerIdsOf(rows, unionId).map((id) => personName(rows.individuals.find((p) => p.id === id)));
	return names.length > 0 ? names.join('–') : null;
}

/**
 * Expand a relationship intent into a concrete plan with preview sentence and warnings.
 * Purely functional: no I/O.
 */
export function planRelationshipCommand(intent: RelationshipIntent, context: PlanContext): RelationshipPlan {
	const { rows } = context;
	const commands: RelationshipCommand[] = [];
	const warnings: PlanWarning[] = [];
	const facts: SentenceFacts = {};
	const assertions = rows.parentChild.map(asParentChild);

	/** Resolve a person the intent names; a new person becomes a create_person command. */
	const resolve = (ref: PersonRef): PersonRef => {
		if (!ref.isNew) return refOf(rows, ref.id);
		const id = context.newId();
		commands.push({
			kind: 'create_person',
			personId: id,
			givenName: ref.givenName,
			surname: ref.surname,
			sex: 'U'
		});
		return { ...ref, id };
	};

	const warnIfCycle = (parentId: string, childId: string, type: ParentChildType, unionId: string | null) => {
		const violations = validateParentChildAssertion({ parentId, childId, type, unionId }, '', assertions, assertions);
		for (const v of violations) {
			if (v.code === 'CYCLE') warnings.push({ code: 'CYCLE', message: v.message });
		}
	};

	let sentenceIntent: RelationshipIntent = intent;

	switch (intent.kind) {
		case 'add_parent': {
			const child = refOf(rows, intent.child.id);
			const parent = resolve(intent.parent);
			// Reuse a union that already links the child to another parent, so the new parent joins
			// the established family rather than creating a disconnected assertion.
			const childUnionIds = [...new Set(assertions.filter((a) => a.childId === child.id && a.unionId).map((a) => a.unionId!))];
			const unionId = childUnionIds[0] ?? null;
			if (childUnionIds.length > 1) {
				warnings.push({
					code: 'MULTIPLE_UNIONS',
					message: 'This person has more than one parental family; the new parent joins the first one listed.'
				});
			}
			commands.push({ kind: 'assert_parent_child', parentId: parent.id, childId: child.id, type: intent.type, unionId });
			warnIfCycle(parent.id, child.id, intent.type, unionId);
			facts.unionLabel = unionId ? unionLabelOf(rows, unionId) : null;
			sentenceIntent = { ...intent, child, parent };
			break;
		}
		case 'add_child': {
			const parent = refOf(rows, intent.parent.id);
			const child = resolve(intent.child);
			// Reuse the union that already contains the parent, so the child joins the parent's family.
			const parentUnionIds = unionIdsOf(rows, parent.id);
			const unionId = parentUnionIds[0] ?? null;
			if (parentUnionIds.length > 1) {
				warnings.push({
					code: 'MULTIPLE_UNIONS',
					message: 'This person belongs to more than one partnership; the child joins the first one listed.'
				});
			}
			commands.push({ kind: 'assert_parent_child', parentId: parent.id, childId: child.id, type: intent.type, unionId });
			warnIfCycle(parent.id, child.id, intent.type, unionId);
			facts.unionLabel = unionId ? unionLabelOf(rows, unionId) : null;
			sentenceIntent = { ...intent, parent, child };
			break;
		}
		case 'add_partner': {
			const person = refOf(rows, intent.person.id);
			const partner = resolve(intent.partner);
			const shared = rows.unions.find((u) => {
				const members = partnerIdsOf(rows, u.id);
				return members.includes(person.id) && members.includes(partner.id);
			});
			if (shared) {
				warnings.push({
					code: 'ALREADY_PARTNERS',
					message: 'These two people are already partners in an existing union.'
				});
			} else {
				// A partnership with only this person in it is waiting for its other partner. A full
				// one is a different partnership, so a new person starts a new union (a remarriage).
				const open = rows.unions.find((u) => {
					const members = partnerIdsOf(rows, u.id);
					return members.length === 1 && members[0] === person.id;
				});
				if (open) commands.push({ kind: 'add_partner_to_union', unionId: open.id, personId: partner.id });
				else commands.push({ kind: 'create_union', unionId: context.newId(), personIds: [person.id, partner.id] });
			}
			sentenceIntent = { ...intent, person, partner };
			break;
		}
		case 'record_death': {
			const person = refOf(rows, intent.person.id);
			const deceased = deceasedIdsOf(rows);
			commands.push({
				kind: 'record_death',
				personId: person.id,
				dateText: intent.dateText?.trim() || null,
				place: intent.place?.trim() || null,
				expectedVersion: intent.personVersion
			});
			if (deceased.has(person.id)) {
				warnings.push({
					code: 'ALREADY_DECEASED',
					message: 'A death is already recorded for this person; saving will update it.'
				});
			}
			const birth = rows.events.find((e) => e.entityType === 'INDIVIDUAL' && e.entityId === person.id && e.type === 'BIRT');
			const born = parseDateValue(birth?.dateRaw);
			const died = parseDateValue(intent.dateText);
			if (born.sortStart && died.sortEnd && died.sortEnd < born.sortStart) {
				warnings.push({ code: 'DEATH_BEFORE_BIRTH', message: 'This death date is earlier than the recorded birth.' });
			}
			const unions = rows.unions.map((u) => ({ id: u.id, status: u.status as UnionStatus, partnerIds: partnerIdsOf(rows, u.id) }));
			facts.widowed = newWidowhoods(unions, deceased, person.id).map((w) => ({
				widow: refOf(rows, w.widowId),
				deceased: refOf(rows, w.deceasedId)
			}));
			sentenceIntent = { ...intent, person };
			break;
		}
		case 'end_union': {
			const person = refOf(rows, intent.person.id);
			const unionIds = unionIdsOf(rows, person.id);
			let unionId = intent.unionId;
			if (unionId && !unionIds.includes(unionId)) {
				warnings.push({ code: 'NO_UNION', message: 'That partnership does not include this person.' });
				unionId = null;
			} else if (!unionId) {
				if (unionIds.length === 1) unionId = unionIds[0];
				else if (unionIds.length === 0) warnings.push({ code: 'NO_UNION', message: 'This person has no partnership to end.' });
				else {
					warnings.push({
						code: 'MULTIPLE_UNIONS',
						message: 'This person belongs to multiple unions; select which one to end.'
					});
				}
			}
			if (unionId) {
				const union = rows.unions.find((u) => u.id === unionId)!;
				commands.push({
					kind: 'end_union',
					unionId,
					status: intent.status,
					event: intent.event
						? { ...intent.event, dateText: intent.event.dateText?.trim() || null, place: intent.event.place?.trim() || null }
						: null,
					expectedVersion: intent.unionVersion
				});
				if (union.status === intent.status) {
					warnings.push({ code: 'UNION_ALREADY_ENDED', message: `This partnership is already recorded as ${union.status}; saving will update it.` });
				}
				const start = rows.events.find(
					(e) => e.entityType === 'FAMILY' && e.entityId === union.id && e.type === 'MARR' && e.dateRaw
				);
				const began = parseDateValue(start?.dateRaw);
				const ended = parseDateValue(intent.event?.dateText);
				if (began.sortStart && ended.sortEnd && ended.sortEnd < began.sortStart) {
					warnings.push({ code: 'END_BEFORE_START', message: 'The end date is earlier than the marriage date.' });
				}
				facts.partners = partnerRefs(rows, union.id);
			}
			sentenceIntent = { ...intent, person, unionId };
			break;
		}
	}

	if (context.hasDuplicateName) {
		warnings.push({
			code: 'DUPLICATE_PERSON',
			message: 'A person with a similar name already exists — verify this is not a duplicate.'
		});
	}

	return {
		sentence: describeRelationshipIntent(sentenceIntent, facts),
		commands,
		warnings
	};
}
