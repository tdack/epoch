/**
 * Phase 2 relationship commands: typed, intent-based mutations against the
 * neutral model. Each command carries the data needed to apply one logical
 * change, and `planRelationshipCommand` expands a high-level intent into the
 * concrete command(s) plus warnings, so the UI can show an exact preview.
 */

import type { ParentChildType, UnionStatus } from './genealogy-model';
import { describeRelationshipIntent, type PersonRef, type RelationshipIntent } from './relationship-sentence';
import { validateParentChildAssertion, hasPath } from './invariants';
import type { ParentChild } from './genealogy-model';

export type RelationshipCommand =
	| {
			kind: 'create_union';
			personIds: string[];
			status?: UnionStatus;
	  }
	| {
			kind: 'assert_parent_child';
			parentId: string;
			childId: string;
			type: ParentChildType;
			unionId: string | null;
	  }
	| {
			kind: 'end_union';
			unionId: string;
	  }
	| {
			kind: 'remove_parent_child';
			parentId: string;
			childId: string;
			type: ParentChildType;
	  };

export interface PlanWarning {
	code: 'DUPLICATE_PERSON' | 'MULTIPLE_UNIONS' | 'UNKNOWN_PARENT' | 'CYCLE' | 'NO_UNION';
	message: string;
}

export interface RelationshipPlan {
	/** Human-readable preview of the resulting graph. */
	sentence: string;
	commands: RelationshipCommand[];
	warnings: PlanWarning[];
}

export interface PlanContext {
	/** Existing parent-child assertions in the tree, used for invariant checks. */
	assertions: ParentChild[];
	/** Whether a similarly named person already exists (duplicate cue). */
	hasDuplicateName: boolean;
	/** Number of unions the subject participates in (for ambiguity cues). */
	unionCount: number;
}

/**
 * Expand a relationship intent into a concrete plan with preview sentence and
 * warnings. Purely functional — no I/O.
 */
export function planRelationshipCommand(intent: RelationshipIntent, context: PlanContext): RelationshipPlan {
	const commands: RelationshipCommand[] = [];
	const warnings: PlanWarning[] = [];

	switch (intent.kind) {
		case 'add_parent': {
			commands.push({
				kind: 'assert_parent_child',
				parentId: intent.parent.id,
				childId: intent.child.id,
				type: intent.type,
				unionId: null
			});
			const violations = validateParentChildAssertion(
				{ parentId: intent.parent.id, childId: intent.child.id, type: intent.type, unionId: null },
				'',
				context.assertions,
				context.assertions
			);
			for (const v of violations) {
				if (v.code === 'CYCLE') warnings.push({ code: 'CYCLE', message: v.message });
			}
			break;
		}
		case 'add_child': {
			commands.push({
				kind: 'assert_parent_child',
				parentId: intent.parent.id,
				childId: intent.child.id,
				type: intent.type,
				unionId: null
			});
			const violations = validateParentChildAssertion(
				{ parentId: intent.parent.id, childId: intent.child.id, type: intent.type, unionId: null },
				'',
				context.assertions,
				context.assertions
			);
			for (const v of violations) {
				if (v.code === 'CYCLE') warnings.push({ code: 'CYCLE', message: v.message });
			}
			break;
		}
		case 'add_partner': {
			commands.push({ kind: 'create_union', personIds: [intent.person.id, intent.partner.id] });
			break;
		}
		case 'record_death': {
			// Death is recorded on the person; widowhood is derived, not stored.
			break;
		}
		case 'end_union': {
			// The union ID is not in the intent (which is label-only); the caller
			// resolves it to a concrete `end_union` command. Emit a warning when
			// there are multiple unions to disambiguate.
			if (context.unionCount > 1) {
				warnings.push({
					code: 'MULTIPLE_UNIONS',
					message: 'This person belongs to multiple unions; select which one to end.'
				});
			}
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
		sentence: describeRelationshipIntent(intent),
		commands,
		warnings
	};
}
