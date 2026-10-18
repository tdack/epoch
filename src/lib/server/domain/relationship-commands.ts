/**
 * Phase 2 relationship commands: typed, intent-based mutations against the neutral model.
 * `planRelationshipCommand` expands a high-level intent into the concrete commands plus warnings
 * and the preview sentence; `tree-ops.ts` turns those commands into row operations.
 */

import type { PersonPrivacy } from '../../shared/privacy';
import { eventDateValue } from './date-columns';
import { parseDateValue } from '../../shared/date-value';
import type { ParentChildType, UnionStatus } from '../../shared/relationship-model';
import type { TreeRows } from './change-log';
import { validateParentChildAssertion } from './invariants';
import {
	describeRelationshipIntent,
	type PersonRef,
	type RelationshipIntent,
	type SentenceFacts
} from './relationship-sentence';
import {
	asParentChild,
	deceasedIdsOf,
	labelableUnionsOf,
	partnerIdsOf,
	unionIdsOf,
	displayNameOf
} from './tree-ops';
import { ValidationError } from './errors';
import { partnershipLabels } from '../../shared/partnership-labels';
import type { MergeChoices } from '../../shared/union-merge';
import {
	ENDED_UNION_STATUSES,
	type EndedUnionStatus,
	type UnionEventInput,
	type UnionEventType
} from '../../shared/union-events';
import { newWidowhoods } from '../../shared/widowhood';
import type { Sex } from '../../shared/sex';
import type { EvidenceCommand } from './evidence-ops';
import type { FactCommand } from './fact-ops';
import type { NameCommand } from './name-ops';
import type { NoteCommand } from './note-ops';
import type { SubtreeCommand } from './subtree-ops';
import type { TaskCommand } from './task-ops';
import type { PersonMergeCommand } from './person-merge';
import type { PlaceCommand } from './place-ops';
import type { DateCommand } from './date-ops';
import type { MediaCommand } from './media-ops';

export type RelationshipCommand =
	| FactCommand
	| EvidenceCommand
	| NoteCommand
	| TaskCommand
	| SubtreeCommand
	| NameCommand
	| PlaceCommand
	| DateCommand
	| PersonMergeCommand
	| MediaCommand
	| {
			kind: 'create_person';
			personId: string;
			givenName: string | null;
			surname: string | null;
			sex: Sex;
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
			sex?: Sex;
			birthDate?: string | null;
			birthPlace?: string | null;
			deathDate?: string | null;
			deathPlace?: string | null;
	  }
	| { kind: 'delete_person'; personId: string; expectedVersion?: number }
	| {
			kind: 'set_person_privacy';
			personId: string;
			privacy: PersonPrivacy;
			expectedVersion?: number;
	  }
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
	| {
			kind: 'remove_partner_from_union';
			unionId: string;
			personId: string;
			expectedVersion?: number;
	  }
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
	| {
			kind: 'change_parent_child_type';
			parentId: string;
			childId: string;
			fromType: ParentChildType;
			toType: ParentChildType;
	  }
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

interface PlanWarning {
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
		| 'END_BEFORE_START'
		| 'TYPE_UNCHANGED'
		| 'TYPE_ALREADY_RECORDED';
	message: string;
}

/** Which partnership a link will use, and why the planner chose it when the intent did not. */
interface UnionChoice {
	/** Null: no partnership (a single-parent record, or a new partnership for add_partner). */
	unionId: string | null;
	isDefault: boolean;
	/** Set only when the planner chose between several candidates. */
	reason: string | null;
}

export interface RelationshipPlan {
	/** Human-readable preview of the resulting graph. */
	sentence: string;
	/** Null for intents that involve no partnership choice. */
	unionChoice: UnionChoice | null;
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

/** "John Smith–Jane Smith": how a family is named in a sentence. */
function unionLabelOf(rows: TreeRows, unionId: string): string | null {
	const names = partnerIdsOf(rows, unionId).map((id) => displayNameOf(rows, id));
	return names.length > 0 ? names.join('–') : null;
}

/**
 * What follows "in the" when a sentence names a partnership: "2nd partnership of John Smith and
 * Jane Smith" when the pair has several, otherwise "John Smith–Jane Smith family".
 */
function unionPhraseOf(rows: TreeRows, unionId: string): string | null {
	const label = partnershipLabels(labelableUnionsOf(rows)).get(unionId);
	const names = partnerIdsOf(rows, unionId).map((id) => displayNameOf(rows, id));
	if (label && names.length >= 2)
		return `${label.title} of ${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
	const family = unionLabelOf(rows, unionId);
	return family ? `${family} family` : null;
}

function childCountOf(rows: TreeRows, unionId: string): number {
	return new Set(rows.parentChild.filter((l) => l.unionId === unionId).map((l) => l.childId)).size;
}

/**
 * Resolve which of `candidates` a link uses. An intent that names one is honoured (or refused when
 * it is not a candidate, since a client could send any id); one that names none gets the fullest
 * candidate, because an empty or stray copy is almost never the family a person means.
 */
function chooseUnion(
	rows: TreeRows,
	requested: string | null | undefined,
	candidates: string[],
	refusal: string
): UnionChoice {
	if (requested === null) return { unionId: null, isDefault: false, reason: null };
	if (requested !== undefined) {
		if (!candidates.includes(requested)) throw new ValidationError(refusal);
		return { unionId: requested, isDefault: false, reason: null };
	}
	if (candidates.length === 0) return { unionId: null, isDefault: true, reason: null };
	if (candidates.length === 1) return { unionId: candidates[0], isDefault: true, reason: null };
	// Most children, then most partners, then id, so the pick is the same on every request.
	const [best] = [...candidates].sort(
		(a, b) =>
			childCountOf(rows, b) - childCountOf(rows, a) ||
			partnerIdsOf(rows, b).length - partnerIdsOf(rows, a).length ||
			a.localeCompare(b)
	);
	const children = childCountOf(rows, best);
	const reason =
		children > 0
			? `Chosen because it has the most children recorded (${children}). Pick another if that is not the family you mean.`
			: 'Chosen by default because none of them has children recorded yet. Check it is the family you mean.';
	return { unionId: best, isDefault: true, reason };
}

/**
 * Expand a relationship intent into a concrete plan with preview sentence and warnings.
 * Purely functional: no I/O.
 */
export function planRelationshipCommand(
	intent: RelationshipIntent,
	context: PlanContext
): RelationshipPlan {
	const { rows } = context;
	const commands: RelationshipCommand[] = [];
	const warnings: PlanWarning[] = [];
	const facts: SentenceFacts = {};
	let unionChoice: UnionChoice | null = null;
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

	const warnIfCycle = (
		parentId: string,
		childId: string,
		type: ParentChildType,
		unionId: string | null
	) => {
		const violations = validateParentChildAssertion(
			{ parentId, childId, type, unionId },
			'',
			assertions,
			assertions
		);
		for (const v of violations) {
			if (v.code === 'CYCLE') warnings.push({ code: 'CYCLE', message: v.message });
		}
	};

	let sentenceIntent: RelationshipIntent = intent;

	switch (intent.kind) {
		case 'add_parent': {
			const child = refOf(rows, intent.child.id);
			const parent = resolve(intent.parent);
			// The new parent joins a family that already links the child to someone, so the link is
			// not a disconnected assertion. With several, the intent names one or the fullest is used.
			const childUnionIds = [
				...new Set(
					assertions.filter((a) => a.childId === child.id && a.unionId).map((a) => a.unionId!)
				)
			];
			unionChoice = chooseUnion(
				rows,
				intent.unionId,
				childUnionIds,
				'That family is not one of this person’s parental families.'
			);
			const unionId = unionChoice.unionId;
			commands.push({
				kind: 'assert_parent_child',
				parentId: parent.id,
				childId: child.id,
				type: intent.type,
				unionId
			});
			warnIfCycle(parent.id, child.id, intent.type, unionId);
			facts.unionPhrase = unionId ? unionPhraseOf(rows, unionId) : null;
			sentenceIntent = { ...intent, child, parent };
			break;
		}
		case 'add_child': {
			const parent = refOf(rows, intent.parent.id);
			const child = resolve(intent.child);
			// The child joins one of the parent's partnerships. Refusing an id the parent is not in
			// keeps a crafted request from filing a child under an unrelated family.
			unionChoice = chooseUnion(
				rows,
				intent.unionId,
				[...new Set(unionIdsOf(rows, parent.id))],
				'That partnership does not include this parent.'
			);
			const unionId = unionChoice.unionId;
			commands.push({
				kind: 'assert_parent_child',
				parentId: parent.id,
				childId: child.id,
				type: intent.type,
				unionId
			});
			warnIfCycle(parent.id, child.id, intent.type, unionId);
			facts.unionPhrase = unionId ? unionPhraseOf(rows, unionId) : null;
			sentenceIntent = { ...intent, parent, child };
			break;
		}
		case 'add_sibling': {
			const person = refOf(rows, intent.person.id);
			const sibling = resolve(intent.sibling);
			if (sibling.id === person.id)
				throw new ValidationError('A person cannot be their own sibling.');
			if (intent.parentIds.length === 0)
				throw new ValidationError('Choose which parents the sibling shares.');
			// A sibling is not a stored relationship: it is two people with a parent in common. So the
			// links written are the sibling's, to parents this person already has, in the same family.
			// Refusing any other id stops a crafted request from filing someone under a stranger.
			const links = assertions.filter((a) => a.childId === person.id);
			const parentRefs: PersonRef[] = [];
			for (const parentId of new Set(intent.parentIds)) {
				const link = links.find((a) => a.parentId === parentId);
				if (!link) throw new ValidationError('That person is not one of this person’s parents.');
				commands.push({
					kind: 'assert_parent_child',
					parentId,
					childId: sibling.id,
					type: intent.type,
					unionId: link.unionId ?? null
				});
				warnIfCycle(parentId, sibling.id, intent.type, link.unionId ?? null);
				parentRefs.push(refOf(rows, parentId));
			}
			facts.siblingParents = parentRefs;
			sentenceIntent = { ...intent, person, sibling };
			break;
		}
		case 'add_partner': {
			const person = refOf(rows, intent.person.id);
			const partner = resolve(intent.partner);
			// A partnership that has ended does not make them partners now: a divorce followed by a
			// remarriage is a second partnership between the same two people, not a duplicate.
			const shared = rows.unions.find((u) => {
				const members = partnerIdsOf(rows, u.id);
				return (
					members.includes(person.id) &&
					members.includes(partner.id) &&
					!(ENDED_UNION_STATUSES as readonly string[]).includes(u.status)
				);
			});
			if (shared) {
				warnings.push({
					code: 'ALREADY_PARTNERS',
					message: 'These two people are already partners in an existing union.'
				});
			} else {
				// A partnership with only this person in it is waiting for its other partner. A full
				// one is a different partnership, so a new person starts a new union (a remarriage).
				const openIds = rows.unions
					.filter((u) => {
						const members = partnerIdsOf(rows, u.id);
						return members.length === 1 && members[0] === person.id;
					})
					.map((u) => u.id);
				unionChoice = chooseUnion(
					rows,
					intent.unionId,
					openIds,
					'That partnership is not waiting for a partner.'
				);
				if (unionChoice.unionId) {
					commands.push({
						kind: 'add_partner_to_union',
						unionId: unionChoice.unionId,
						personId: partner.id
					});
				} else {
					commands.push({
						kind: 'create_union',
						unionId: context.newId(),
						personIds: [person.id, partner.id]
					});
				}
			}
			sentenceIntent = { ...intent, person, partner };
			break;
		}
		case 'change_link_type': {
			const parent = refOf(rows, intent.parent.id);
			const child = refOf(rows, intent.child.id);
			const link = rows.parentChild.find(
				(l) => l.parentId === parent.id && l.childId === child.id && l.type === intent.fromType
			);
			if (!link)
				throw new ValidationError(
					'That parent link no longer exists as described. Reload and try again.'
				);
			if (intent.fromType === intent.toType) {
				warnings.push({
					code: 'TYPE_UNCHANGED',
					message: 'The link already has this type; nothing to save.'
				});
			} else if (
				rows.parentChild.some(
					(l) => l.parentId === parent.id && l.childId === child.id && l.type === intent.toType
				)
			) {
				warnings.push({
					code: 'TYPE_ALREADY_RECORDED',
					message:
						'This parent is already recorded with that type for this child. Remove one of the two links instead.'
				});
			} else {
				commands.push({
					kind: 'change_parent_child_type',
					parentId: parent.id,
					childId: child.id,
					fromType: intent.fromType,
					toType: intent.toType
				});
			}
			facts.unionPhrase = link.unionId ? unionPhraseOf(rows, link.unionId) : null;
			sentenceIntent = { ...intent, parent, child };
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
			const birth = rows.events.find(
				(e) => e.entityType === 'INDIVIDUAL' && e.entityId === person.id && e.type === 'BIRT'
			);
			const born = birth ? eventDateValue(birth) : parseDateValue(null);
			const died = parseDateValue(intent.dateText);
			if (born.sortStart && died.sortEnd && died.sortEnd < born.sortStart) {
				warnings.push({
					code: 'DEATH_BEFORE_BIRTH',
					message: 'This death date is earlier than the recorded birth.'
				});
			}
			const unions = rows.unions.map((u) => ({
				id: u.id,
				status: u.status as UnionStatus,
				partnerIds: partnerIdsOf(rows, u.id)
			}));
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
				warnings.push({
					code: 'NO_UNION',
					message: 'That partnership does not include this person.'
				});
				unionId = null;
			} else if (!unionId) {
				if (unionIds.length === 1) unionId = unionIds[0];
				else if (unionIds.length === 0)
					warnings.push({ code: 'NO_UNION', message: 'This person has no partnership to end.' });
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
						? {
								...intent.event,
								dateText: intent.event.dateText?.trim() || null,
								place: intent.event.place?.trim() || null
							}
						: null,
					expectedVersion: intent.unionVersion
				});
				if (union.status === intent.status) {
					warnings.push({
						code: 'UNION_ALREADY_ENDED',
						message: `This partnership is already recorded as ${union.status}; saving will update it.`
					});
				}
				const start = rows.events.find(
					(e) =>
						e.entityType === 'FAMILY' && e.entityId === union.id && e.type === 'MARR' && e.dateRaw
				);
				const began = start ? eventDateValue(start) : parseDateValue(null);
				const ended = parseDateValue(intent.event?.dateText);
				if (began.sortStart && ended.sortEnd && ended.sortEnd < began.sortStart) {
					warnings.push({
						code: 'END_BEFORE_START',
						message: 'The end date is earlier than the marriage date.'
					});
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
		unionChoice,
		commands,
		warnings
	};
}
