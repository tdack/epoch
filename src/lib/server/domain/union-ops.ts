/**
 * Row operations for partnerships and parent links (create, partners, parentage, end, edit, merge,
 * delete). Split out of `tree-ops.ts` beside the other `*-ops` modules; `tree-ops.ts` dispatches
 * to `buildUnionOps` and re-exports `asParentChild` and `mergeConflictsOf` for its importers.
 */

import type {
	EventRow,
	ParentChildRow,
	RowOp,
	TreeRows,
	UnionPartnerRow,
	UnionRow
} from './change-log';
import { dateColumnsFor } from './date-columns';
import { NotFoundError, UnionMergeConflictError, ValidationError } from './errors';
import type { ParentChild } from './genealogy-model';
import { makeEvidenceMover } from './evidence-ops';
import { validateParentChildAssertion } from './invariants';
import type { RelationshipCommand } from './relationship-commands';
import {
	type OpContext,
	bump,
	cleanText,
	createEvent,
	detachFilesOf,
	eventsOf,
	partnerIdsOf,
	requirePerson,
	requireUnion,
	staleVersion,
	touch,
	upsertEvent
} from './op-helpers';
import { CITATION_SUBJECT_KINDS } from '../../shared/evidence';
import type { UnionStatus } from '../../shared/relationship-model';
import {
	factKey,
	findMergeConflicts,
	mergeFactOf,
	partnerSetKey,
	unresolvedConflicts,
	type MergeConflict,
	type MergeFact,
	type MergeableUnion
} from '../../shared/union-merge';
import { ENDED_UNION_STATUSES, isUnionEventType } from '../../shared/union-events';

export type UnionCommand = Extract<
	RelationshipCommand,
	{
		kind:
			| 'create_union'
			| 'add_partner_to_union'
			| 'remove_partner_from_union'
			| 'assert_parent_child'
			| 'remove_parent_child'
			| 'change_parent_child_type'
			| 'destroy_union'
			| 'end_union'
			| 'update_union'
			| 'merge_unions';
	}
>;

/** Ops for one union or parent-link command against the tree as it currently is. */
export function buildUnionOps(rows: TreeRows, command: UnionCommand, ctx: OpContext): RowOp[] {
	switch (command.kind) {
		case 'create_union':
			return createUnion(rows, ctx, command);
		case 'add_partner_to_union':
			return addPartner(rows, ctx, command);
		case 'remove_partner_from_union':
			return removePartner(rows, ctx, command);
		case 'assert_parent_child':
			return assertParentChild(rows, ctx, command);
		case 'remove_parent_child':
			return removeParentChild(rows, ctx, command);
		case 'change_parent_child_type':
			return changeParentChildType(rows, ctx, command);
		case 'destroy_union':
			return destroyUnion(rows, ctx, command);
		case 'end_union':
			return endUnion(rows, ctx, command);
		case 'update_union':
			return updateUnion(rows, ctx, command);
		case 'merge_unions':
			return mergeUnions(rows, ctx, command);
	}
}

interface UnionConflictSnapshot {
	status: UnionStatus;
	events: Array<{ id: string; type: string; dateText: string | null; place: string | null }>;
}

function unionSnapshot(rows: TreeRows, union: UnionRow): UnionConflictSnapshot {
	return {
		status: union.status as UnionStatus,
		events: eventsOf(rows, 'FAMILY', union.id)
			.filter((e) => isUnionEventType(e.type))
			.map((e) => ({ id: e.id, type: e.type, dateText: e.dateRaw, place: e.place }))
	};
}

function checkUnionVersion(rows: TreeRows, union: UnionRow, expected: number | undefined) {
	if (expected !== undefined && union.version !== expected) {
		throw staleVersion('union', union.id, union.version, expected, unionSnapshot(rows, union));
	}
}

/**
 * Names that say they came from `unionId` (for `personId` only, when given), rewritten to point at
 * `toUnionId`. Done here rather than by a foreign key so the change is logged and undoable.
 */
function relinkNames(
	rows: TreeRows,
	ctx: OpContext,
	unionId: string[],
	toUnionId: string | null,
	personId?: string
): RowOp[] {
	return rows.personNames
		.filter(
			(n) =>
				n.unionId !== null &&
				unionId.includes(n.unionId) &&
				(personId === undefined || n.personId === personId)
		)
		.map((n) => ({
			table: 'person_names' as const,
			id: n.id,
			before: n,
			after: touch({ ...n, unionId: toUnionId }, ctx)
		}));
}

function createUnion(
	rows: TreeRows,
	ctx: OpContext,
	command: Extract<RelationshipCommand, { kind: 'create_union' }>
): RowOp[] {
	const personIds = [...new Set(command.personIds)];
	if (personIds.length < 1) throw new ValidationError('A union requires at least one participant');
	for (const id of personIds) requirePerson(rows, id);
	const union: UnionRow = {
		id: command.unionId,
		treeId: ctx.treeId,
		status: command.status ?? 'active',
		xrefAliases: null,
		version: 1,
		createdAt: ctx.now,
		updatedAt: ctx.now
	};
	const ops: RowOp[] = [{ table: 'unions', id: union.id, before: null, after: union }];
	personIds.forEach((personId, order) => {
		const id = ctx.newId();
		const partner: UnionPartnerRow = { id, unionId: union.id, personId, order, createdAt: ctx.now };
		ops.push({ table: 'union_partners', id, before: null, after: partner });
	});
	return ops;
}

function addPartner(
	rows: TreeRows,
	ctx: OpContext,
	command: Extract<RelationshipCommand, { kind: 'add_partner_to_union' }>
): RowOp[] {
	const union = requireUnion(rows, command.unionId);
	requirePerson(rows, command.personId);
	const members = rows.unionPartners.filter((p) => p.unionId === union.id);
	if (members.some((p) => p.personId === command.personId)) return [];
	const id = ctx.newId();
	const order = members.reduce((max, p) => Math.max(max, p.order), -1) + 1;
	const partner: UnionPartnerRow = {
		id,
		unionId: union.id,
		personId: command.personId,
		order,
		createdAt: ctx.now
	};
	return [
		bump('unions', union, ctx),
		{ table: 'union_partners', id, before: null, after: partner }
	];
}

function removePartner(
	rows: TreeRows,
	ctx: OpContext,
	command: Extract<RelationshipCommand, { kind: 'remove_partner_from_union' }>
): RowOp[] {
	const union = requireUnion(rows, command.unionId);
	checkUnionVersion(rows, union, command.expectedVersion);
	const membership = rows.unionPartners.find(
		(p) => p.unionId === union.id && p.personId === command.personId
	);
	if (!membership) throw new NotFoundError('Partner', command.personId);
	// A name that came from this partnership no longer has a partner in it to have come from.
	return [
		bump('unions', union, ctx),
		{ table: 'union_partners', id: membership.id, before: membership, after: null },
		...relinkNames(rows, ctx, [union.id], null, command.personId)
	];
}

function assertParentChild(
	rows: TreeRows,
	ctx: OpContext,
	command: Extract<RelationshipCommand, { kind: 'assert_parent_child' }>
): RowOp[] {
	requirePerson(rows, command.parentId);
	requirePerson(rows, command.childId);
	if (command.unionId) requireUnion(rows, command.unionId);
	const existing = rows.parentChild.map(asParentChild);
	const violations = validateParentChildAssertion(
		{
			parentId: command.parentId,
			childId: command.childId,
			type: command.type,
			unionId: command.unionId
		},
		ctx.treeId,
		existing,
		existing
	);
	if (violations.length > 0) throw new ValidationError(violations[0].message);
	const id = ctx.newId();
	const link: ParentChildRow = {
		id,
		treeId: ctx.treeId,
		parentId: command.parentId,
		childId: command.childId,
		type: command.type,
		status: 'active',
		unionId: command.unionId,
		gedcomPedi: null,
		version: 1,
		createdAt: ctx.now,
		updatedAt: ctx.now
	};
	return [{ table: 'parent_child', id, before: null, after: link }];
}

/** The domain type the invariant checks expect; only the fields they read matter. */
export function asParentChild(row: ParentChildRow): ParentChild {
	return {
		id: row.id,
		treeId: row.treeId,
		parentId: row.parentId,
		childId: row.childId,
		type: row.type,
		status: row.status,
		unionId: row.unionId,
		version: row.version,
		createdAt: new Date(row.createdAt ?? 0),
		updatedAt: new Date(row.updatedAt ?? 0)
	};
}

function removeParentChild(
	rows: TreeRows,
	_ctx: OpContext,
	command: Extract<RelationshipCommand, { kind: 'remove_parent_child' }>
): RowOp[] {
	const link = rows.parentChild.find(
		(l) =>
			l.parentId === command.parentId && l.childId === command.childId && l.type === command.type
	);
	if (!link) throw new NotFoundError('Parent link');
	return [{ table: 'parent_child', id: link.id, before: link, after: null }];
}

function changeParentChildType(
	rows: TreeRows,
	ctx: OpContext,
	command: Extract<RelationshipCommand, { kind: 'change_parent_child_type' }>
): RowOp[] {
	const link = rows.parentChild.find(
		(l) =>
			l.parentId === command.parentId &&
			l.childId === command.childId &&
			l.type === command.fromType
	);
	if (!link) throw new NotFoundError('Parent link');
	if (command.fromType === command.toType) return [];
	if (
		rows.parentChild.some(
			(l) =>
				l.parentId === command.parentId &&
				l.childId === command.childId &&
				l.type === command.toType
		)
	) {
		throw new ValidationError('That parent is already recorded with this type for this child');
	}
	// The raw PEDI word only qualified the old type (sealing, other); it says nothing about the new one.
	return [
		{
			table: 'parent_child',
			id: link.id,
			before: link,
			after: touch({ ...link, type: command.toType, gedcomPedi: null }, ctx)
		}
	];
}

function destroyUnion(
	rows: TreeRows,
	ctx: OpContext,
	command: Extract<RelationshipCommand, { kind: 'destroy_union' }>
): RowOp[] {
	const union = requireUnion(rows, command.unionId);
	checkUnionVersion(rows, union, command.expectedVersion);
	const ops: RowOp[] = [];
	rows.unionPartners
		.filter((p) => p.unionId === union.id)
		.forEach((p) => ops.push({ table: 'union_partners', id: p.id, before: p, after: null }));
	eventsOf(rows, 'FAMILY', union.id).forEach((e) =>
		ops.push({ table: 'events', id: e.id, before: e, after: null })
	);
	ops.push(...detachFilesOf(rows, ctx, new Set([union.id])));
	// Parentage is a fact about the parent and child, not about the partnership, so the links stay
	// and only lose their grouping. Deleting them would erase who someone's parents were.
	for (const link of rows.parentChild.filter((l) => l.unionId === union.id)) {
		ops.push({
			table: 'parent_child',
			id: link.id,
			before: link,
			after: touch({ ...link, unionId: null }, ctx)
		});
	}
	ops.push(...relinkNames(rows, ctx, [union.id], null));
	ops.push({ table: 'unions', id: union.id, before: union, after: null });
	return ops;
}

function endUnion(
	rows: TreeRows,
	ctx: OpContext,
	command: Extract<RelationshipCommand, { kind: 'end_union' }>
): RowOp[] {
	const union = requireUnion(rows, command.unionId);
	checkUnionVersion(rows, union, command.expectedVersion);
	if (!(ENDED_UNION_STATUSES as readonly string[]).includes(command.status)) {
		throw new ValidationError(`'${command.status}' is not an ending status`);
	}
	const eventOps = command.event
		? upsertEvent(
				rows,
				ctx,
				'FAMILY',
				union.id,
				command.event.type,
				{ dateText: command.event.dateText, place: command.event.place },
				true
			)
		: [];
	const isStatusChanged = union.status !== command.status;
	if (!isStatusChanged && eventOps.length === 0) return [];
	return [
		{
			table: 'unions',
			id: union.id,
			before: union,
			after: touch({ ...union, status: command.status }, ctx)
		},
		...eventOps
	];
}

function updateUnion(
	rows: TreeRows,
	ctx: OpContext,
	command: Extract<RelationshipCommand, { kind: 'update_union' }>
): RowOp[] {
	const union = requireUnion(rows, command.unionId);
	checkUnionVersion(rows, union, command.expectedVersion);

	const eventOps: RowOp[] = [];
	if (command.events) {
		const editable = eventsOf(rows, 'FAMILY', union.id).filter((e) => isUnionEventType(e.type));
		const submittedIds = new Set(command.events.map((e) => e.id).filter(Boolean));
		for (const input of command.events) {
			if (!isUnionEventType(input.type))
				throw new ValidationError(`'${input.type}' is not a partnership event`);
			if (!input.id) {
				eventOps.push(
					createEvent(
						ctx,
						'FAMILY',
						union.id,
						input.type,
						cleanText(input.dateText),
						cleanText(input.place)
					)
				);
				continue;
			}
			const existing = editable.find((e) => e.id === input.id);
			if (!existing) throw new ValidationError('That event does not belong to this partnership');
			const after: EventRow = {
				...existing,
				type: input.type,
				dateRaw: cleanText(input.dateText),
				...dateColumnsFor(cleanText(input.dateText)),
				place: cleanText(input.place)
			};
			const isChanged =
				after.type !== existing.type ||
				after.dateRaw !== existing.dateRaw ||
				after.place !== existing.place;
			if (isChanged)
				eventOps.push({
					table: 'events',
					id: existing.id,
					before: existing,
					after: touch(after, ctx)
				});
		}
		// An event the editor showed but no longer submits was removed by the person editing.
		for (const existing of editable) {
			if (!submittedIds.has(existing.id))
				eventOps.push({ table: 'events', id: existing.id, before: existing, after: null });
		}
	}

	const status = command.status ?? (union.status as UnionStatus);
	if (status === union.status && eventOps.length === 0) return [];
	return [
		{ table: 'unions', id: union.id, before: union, after: touch({ ...union, status }, ctx) },
		...eventOps
	];
}

/** The union's facts in the shape the merge rules compare. */
function mergeableUnion(rows: TreeRows, union: UnionRow): MergeableUnion {
	return {
		id: union.id,
		status: union.status,
		facts: eventsOf(rows, 'FAMILY', union.id).map((e): MergeFact => mergeFactOf(e))
	};
}

/** Every disagreement between these unions, before any choice is applied. */
export function mergeConflictsOf(rows: TreeRows, unionIds: string[]): MergeConflict[] {
	return findMergeConflicts(unionIds.map((id) => mergeableUnion(rows, requireUnion(rows, id))));
}

/** An imported union's id is `<treeId>:<xref>`; anything else was never known by an XREF. */
function xrefOf(treeId: string, unionId: string): string | null {
	const prefix = `${treeId}:`;
	return unionId.startsWith(prefix) ? unionId.slice(prefix.length) : null;
}

function mergeUnions(
	rows: TreeRows,
	ctx: OpContext,
	command: Extract<RelationshipCommand, { kind: 'merge_unions' }>
): RowOp[] {
	const mergedIds = [...new Set(command.mergedIds)].filter((id) => id !== command.survivorId);
	if (mergedIds.length === 0)
		throw new ValidationError('Choose at least two partnerships to merge');

	const survivor = requireUnion(rows, command.survivorId);
	const merged = mergedIds.map((id) => requireUnion(rows, id));
	const involved = [survivor, ...merged];
	for (const union of involved)
		checkUnionVersion(rows, union, command.expectedVersions?.[union.id]);

	const key = partnerSetKey(partnerIdsOf(rows, survivor.id));
	if (!key || involved.some((u) => partnerSetKey(partnerIdsOf(rows, u.id)) !== key)) {
		throw new ValidationError('Only partnerships between exactly the same people can be merged');
	}

	// Never pick between two different facts on the person's behalf.
	const conflicts = mergeConflictsOf(
		rows,
		involved.map((u) => u.id)
	);
	const unresolved = unresolvedConflicts(conflicts, command.keep);
	if (unresolved.length > 0) {
		throw new UnionMergeConflictError(
			'These partnerships record different facts; choose which to keep for each.',
			unresolved
		);
	}
	const keptStatusFrom = command.keep?.status ? requireUnion(rows, command.keep.status) : survivor;

	const ops: RowOp[] = [];
	const mergedSet = new Set(mergedIds);

	// Events: the survivor's stay; a merged union's move over unless the survivor already states the
	// same fact, or a conflict was settled in favour of another union.
	const chosenFor = (type: string) => command.keep?.events?.[type];
	// What a deleted fact cited is evidence, and stays: with the identical fact that is kept, or, when
	// a different claim was chosen over it, on the partnership itself.
	const citations = makeEvidenceMover(rows, ctx);
	const seen = new Map<string, string>();
	for (const union of involved) {
		for (const event of eventsOf(rows, 'FAMILY', union.id)) {
			const chosen = conflicts.some((c) => c.kind === 'event' && c.eventType === event.type)
				? chosenFor(event.type)
				: undefined;
			const isLoser = chosen !== undefined && chosen !== union.id;
			const key = factKey(mergeFactOf(event));
			const isFactSeen = seen.has(key);
			if (isLoser || (union.id !== survivor.id && isFactSeen)) {
				ops.push({ table: 'events', id: event.id, before: event, after: null });
				const keptEventId = isLoser ? undefined : seen.get(key);
				ops.push(
					...citations.move(
						{ kind: CITATION_SUBJECT_KINDS.EVENT, id: event.id },
						keptEventId
							? { kind: CITATION_SUBJECT_KINDS.EVENT, id: keptEventId }
							: { kind: CITATION_SUBJECT_KINDS.UNION, id: survivor.id }
					)
				);
				continue;
			}
			seen.set(key, event.id);
			if (union.id !== survivor.id) {
				ops.push({
					table: 'events',
					id: event.id,
					before: event,
					after: touch({ ...event, entityId: survivor.id }, ctx)
				});
			}
		}
	}

	// The partnerships' own citations, in the order they had, follow them to the survivor.
	for (const union of merged) {
		ops.push(
			...citations.move(
				{ kind: CITATION_SUBJECT_KINDS.UNION, id: union.id },
				{ kind: CITATION_SUBJECT_KINDS.UNION, id: survivor.id }
			)
		);
	}

	// Parentage is a fact about parent and child, so every link is kept and only regrouped.
	for (const link of rows.parentChild.filter(
		(l) => l.unionId !== null && mergedSet.has(l.unionId)
	)) {
		ops.push({
			table: 'parent_child',
			id: link.id,
			before: link,
			after: touch({ ...link, unionId: survivor.id }, ctx)
		});
	}

	// The partner rows repeat the survivor's, and (union, person) is unique, so they are deleted, not moved.
	for (const partner of rows.unionPartners.filter((p) => mergedSet.has(p.unionId))) {
		ops.push({ table: 'union_partners', id: partner.id, before: partner, after: null });
	}

	// A file of a merged partnership is the survivor's now, as it would be if it had been theirs.
	for (const media of rows.mediaItems) {
		if (media.entityId === null || !mergedSet.has(media.entityId)) continue;
		ops.push({
			table: 'media_items',
			id: media.id,
			before: media,
			after: touch({ ...media, entityId: survivor.id }, ctx)
		});
	}

	ops.push(...relinkNames(rows, ctx, mergedIds, survivor.id));

	const aliases = [...(survivor.xrefAliases ?? [])];
	for (const union of merged) {
		for (const alias of [xrefOf(ctx.treeId, union.id), ...(union.xrefAliases ?? [])]) {
			if (alias && alias !== xrefOf(ctx.treeId, survivor.id) && !aliases.includes(alias))
				aliases.push(alias);
		}
		ops.push({ table: 'unions', id: union.id, before: union, after: null });
	}
	ops.push({
		table: 'unions',
		id: survivor.id,
		before: survivor,
		after: touch(
			{
				...survivor,
				status: keptStatusFrom.status,
				xrefAliases: aliases.length > 0 ? aliases : null
			},
			ctx
		)
	});
	return ops;
}
