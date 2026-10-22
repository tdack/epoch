/**
 * Command semantics: turns a command into row operations against a snapshot of the tree.
 *
 * Pure and synchronous. Nothing here reads or writes the database; the service loads a `TreeRows`
 * snapshot, plans the ops with these functions, and the change store applies them atomically.
 * Planning first is also what makes previews exact: the preview is the description of the very
 * ops that will be written.
 *
 * The person and union commands live in `person-ops.ts` and `union-ops.ts`, their shared helpers in
 * `op-helpers.ts`; this module dispatches to them and plans a whole command list.
 */

import { type RecordTable, type RowOp, type TreeRows } from './change-log';
import { personName } from '../../shared/person-name';
import { displayNameWith } from '../../shared/name-types';
import type { LabelableUnion } from '../../shared/partnership-labels';
import { buildFactOps } from './fact-ops';
import { buildEvidenceOps, citationCascadeOps } from './evidence-ops';
import { buildNoteOps, noteCascadeOps } from './note-ops';
import { buildSubtreeOps } from './subtree-ops';
import { buildTaskOps, taskCascadeOps } from './task-ops';
import { buildMediaOps } from './media-ops';
import { buildPersonMergeOps } from './person-merge';
import { buildDateOps } from './date-ops';
import { buildPlaceOps } from './place-ops';
import { buildNameOps } from './name-ops';
import { buildPersonOps } from './person-ops';
import { buildUnionOps } from './union-ops';
import { type OpContext, partnerIdsOf } from './op-helpers';
import type { RelationshipCommand } from './relationship-commands';

export { asParentChild, mergeConflictsOf } from './union-ops';
export { personName, partnerIdsOf };
export type { OpContext };

/** "Jane Smith (née Doe)": the name for a preview, a summary or a sentence, from the rows as they are. */
export function displayNameOf(rows: TreeRows, personId: string): string {
	return displayNameWith(
		rows.individuals.find((p) => p.id === personId),
		rows.personNames.filter((n) => n.personId === personId)
	);
}

const TABLE_KEYS: Record<RecordTable, keyof TreeRows> = {
	individuals: 'individuals',
	person_names: 'personNames',
	unions: 'unions',
	union_partners: 'unionPartners',
	parent_child: 'parentChild',
	events: 'events',
	media_items: 'mediaItems',
	sources: 'sources',
	repositories: 'repositories',
	source_repositories: 'sourceRepositories',
	citations: 'citations',
	notes: 'notes',
	note_attachments: 'noteAttachments',
	research_tasks: 'researchTasks',
	subtree: 'subtrees'
};

/** The snapshot after `ops`, so a later command in the same plan sees an earlier one's rows. */
export function applyOpsToRows(rows: TreeRows, ops: RowOp[]): TreeRows {
	const next = { ...rows } as Record<keyof TreeRows, { id: string }[]>;
	for (const op of ops) {
		const key = TABLE_KEYS[op.table];
		const kept = next[key].filter((row) => row.id !== op.id);
		next[key] = op.after ? [...kept, op.after] : kept;
	}
	return next as unknown as TreeRows;
}

/** Fold ops on the same row into one, so a row is written once however many commands touched it. */
function mergeOps(ops: RowOp[]): RowOp[] {
	const merged = new Map<string, RowOp>();
	for (const op of ops) {
		const key = `${op.table}:${op.id}`;
		const earlier = merged.get(key);
		if (!earlier) {
			merged.set(key, { ...op });
			continue;
		}
		// Same row, so the same table: the spread cannot show that.
		merged.set(key, { ...earlier, after: op.after } as RowOp);
	}
	return [...merged.values()].filter((op) => op.before !== null || op.after !== null);
}

export function unionIdsOf(rows: TreeRows, personId: string): string[] {
	return rows.unionPartners.filter((p) => p.personId === personId).map((p) => p.unionId);
}

/** Every union with its partners and events, in the shape `partnershipLabels` reads. */
export function labelableUnionsOf(rows: TreeRows): LabelableUnion[] {
	return rows.unions.map((u) => ({
		id: u.id,
		createdAt: u.createdAt,
		partnerIds: partnerIdsOf(rows, u.id),
		events: rows.events
			.filter((e) => e.entityType === 'FAMILY' && e.entityId === u.id)
			.map((e) => ({ type: e.type, dateText: e.dateRaw, dateSort: e.dateSort }))
	}));
}

export function deceasedIdsOf(rows: TreeRows): Set<string> {
	return new Set(
		rows.events
			.filter((e) => e.entityType === 'INDIVIDUAL' && e.type === 'DEAT')
			.map((e) => e.entityId)
	);
}

// ---- Conflicts ----

// ---- Builders, one per command ----

/** Ops for one command against the tree as it currently is. */
function buildOps(rows: TreeRows, command: RelationshipCommand, ctx: OpContext): RowOp[] {
	switch (command.kind) {
		case 'create_fact':
		case 'update_fact':
		case 'delete_fact':
		case 'reorder_facts':
			return buildFactOps(rows, command, ctx);
		case 'create_name':
		case 'update_name':
		case 'delete_name':
		case 'reorder_names':
		case 'set_preferred_name':
			return buildNameOps(rows, command, ctx);
		case 'create_source':
		case 'update_source':
		case 'delete_source':
		case 'merge_sources':
		case 'create_repository':
		case 'update_repository':
		case 'delete_repository':
		case 'link_repository':
		case 'update_source_repository':
		case 'unlink_repository':
		case 'add_citation':
		case 'update_citation':
		case 'remove_citation':
		case 'reorder_citations':
			return buildEvidenceOps(rows, command, ctx);
		case 'add_note':
		case 'update_note':
		case 'remove_note':
		case 'reorder_notes':
		case 'share_note':
		case 'attach_note':
		case 'create_note':
		case 'update_shared_note':
		case 'delete_shared_note':
		case 'merge_notes':
			return buildNoteOps(rows, command, ctx);
		case 'rename_media':
		case 'attach_media':
		case 'detach_media':
			return buildMediaOps(rows, command, { treeId: ctx.treeId, now: ctx.now });
		case 'create_task':
		case 'update_task':
		case 'delete_task':
			return buildTaskOps(rows, command, ctx);
		case 'create_subtree':
		case 'update_subtree':
		case 'delete_subtree':
		case 'reorder_subtrees':
			return buildSubtreeOps(rows, command, ctx);
		case 'rewrite_place':
			return buildPlaceOps(rows, command, ctx);
		case 'standardise_dates':
			return buildDateOps(rows, command, ctx);
		case 'merge_people':
			return buildPersonMergeOps(rows, command, ctx);
		case 'create_person':
		case 'update_person':
		case 'delete_person':
		case 'set_person_privacy':
		case 'record_death':
			return buildPersonOps(rows, command, ctx);
		case 'create_union':
		case 'add_partner_to_union':
		case 'remove_partner_from_union':
		case 'assert_parent_child':
		case 'remove_parent_child':
		case 'change_parent_child_type':
		case 'destroy_union':
		case 'end_union':
		case 'update_union':
		case 'merge_unions':
			return buildUnionOps(rows, command, ctx);
	}
}

/** Ops for a whole plan; each command sees the rows the earlier ones produced. */
export function buildPlanOps(
	rows: TreeRows,
	commands: RelationshipCommand[],
	ctx: OpContext
): RowOp[] {
	let working = rows;
	const all: RowOp[] = [];
	for (const command of commands) {
		const planned = buildOps(working, command, ctx);
		// A command that removes a person, name, fact, partnership or link takes its citations, and the
		// notes on all of those, with it.
		const withCitations = [...planned, ...citationCascadeOps(working, planned)];
		const withNotes = [...withCitations, ...noteCascadeOps(working, withCitations)];
		// A task about a record that goes is kept, with its link cleared.
		const ops = [...withNotes, ...taskCascadeOps(working, withNotes, ctx)];
		all.push(...ops);
		working = applyOpsToRows(working, ops);
	}
	return mergeOps(all);
}
