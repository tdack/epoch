/**
 * Command semantics: turns a command into row operations against a snapshot of the tree.
 *
 * Pure and synchronous. Nothing here reads or writes the database; the service loads a `TreeRows`
 * snapshot, plans the ops with these functions, and the change store applies them atomically.
 * Planning first is also what makes previews exact: the preview is the description of the very
 * ops that will be written.
 */

import {
	ENTITY_TYPES,
	type EventRow,
	type IndividualRow,
	type ParentChildRow,
	type RecordTable,
	type RowImage,
	type RowOp,
	type TreeRows,
	type UnionPartnerRow,
	type UnionRow
} from './change-log';
import { dateColumnsFor } from './date-columns';
import { personName } from '../../shared/person-name';
import { displayNameWith } from '../../shared/name-types';
import type { LabelableUnion } from '../../shared/partnership-labels';
import { ConcurrencyConflictError, NotFoundError, UnionMergeConflictError, ValidationError } from './errors';
import type { ParentChild, UnionStatus } from './genealogy-model';
import { buildFactOps } from './fact-ops';
import { buildPlaceOps } from './place-ops';
import { buildNameOps, initialNameOp, preferredNameOps } from './name-ops';
import { validateParentChildAssertion } from './invariants';
import type { RelationshipCommand } from './relationship-commands';
import {
	factKey,
	findMergeConflicts,
	partnerSetKey,
	unresolvedConflicts,
	type MergeConflict,
	type MergeFact,
	type MergeableUnion
} from '../../shared/union-merge';
import {
	ENDED_UNION_STATUSES,
	isUnionEventType,
	type UnionEventInput,
	type UnionEventType
} from '../../shared/union-events';

export interface OpContext {
	treeId: string;
	/** Epoch milliseconds, stamped on every row written. */
	now: number;
	newId: () => string;
	/** The user making the change, recorded as the author of a person it creates. */
	actorId: string | null;
}

// ---- Small helpers ----

export function cleanText(value: string | null | undefined): string | null {
	const trimmed = value?.trim();
	return trimmed ? trimmed : null;
}

export { personName };

/** "Jessica Wren (née Lovejoy)": the name for a preview, a summary or a sentence, from the rows as they are. */
export function displayNameOf(rows: TreeRows, personId: string): string {
	return displayNameWith(rows.individuals.find((p) => p.id === personId), rows.personNames.filter((n) => n.personId === personId));
}

const TABLE_KEYS: Record<RecordTable, keyof TreeRows> = {
	individuals: 'individuals',
	person_names: 'personNames',
	unions: 'unions',
	union_partners: 'unionPartners',
	parent_child: 'parentChild',
	events: 'events',
	media_items: 'mediaItems'
};

/** The snapshot after `ops`, so a later command in the same plan sees an earlier one's rows. */
export function applyOpsToRows(rows: TreeRows, ops: RowOp[]): TreeRows {
	const next = { ...rows } as Record<keyof TreeRows, { id: string }[]>;
	for (const op of ops) {
		const key = TABLE_KEYS[op.table];
		const kept = next[key].filter((row) => row.id !== op.id);
		next[key] = op.after ? [...kept, op.after as { id: string }] : kept;
	}
	return next as unknown as TreeRows;
}

/** Fold ops on the same row into one, so a row is written once however many commands touched it. */
export function mergeOps(ops: RowOp[]): RowOp[] {
	const merged = new Map<string, RowOp>();
	for (const op of ops) {
		const key = `${op.table}:${op.id}`;
		const earlier = merged.get(key);
		if (!earlier) {
			merged.set(key, { ...op });
			continue;
		}
		merged.set(key, { ...earlier, after: op.after });
	}
	return [...merged.values()].filter((op) => op.before !== null || op.after !== null);
}

export function partnerIdsOf(rows: TreeRows, unionId: string): string[] {
	return rows.unionPartners
		.filter((p) => p.unionId === unionId)
		.sort((a, b) => a.order - b.order)
		.map((p) => p.personId);
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
	return new Set(rows.events.filter((e) => e.entityType === 'INDIVIDUAL' && e.type === 'DEAT').map((e) => e.entityId));
}

function requirePerson(rows: TreeRows, id: string): IndividualRow {
	const person = rows.individuals.find((p) => p.id === id);
	if (!person) throw new NotFoundError('Person', id);
	return person;
}

function requireUnion(rows: TreeRows, id: string): UnionRow {
	const union = rows.unions.find((u) => u.id === id);
	if (!union) throw new NotFoundError('Union', id);
	return union;
}

function eventsOf(rows: TreeRows, entityType: 'INDIVIDUAL' | 'FAMILY', entityId: string): EventRow[] {
	return rows.events.filter((e) => e.entityType === entityType && e.entityId === entityId);
}

// ---- Conflicts ----

/** What the conflict dialog shows as "current": the editable fields of a person. */
export interface PersonConflictSnapshot {
	givenName: string | null;
	surname: string | null;
	sex: string | null;
	birthDate: string | null;
	birthPlace: string | null;
	deathDate: string | null;
	deathPlace: string | null;
}

export interface UnionConflictSnapshot {
	status: UnionStatus;
	events: Array<{ id: string; type: string; dateText: string | null; place: string | null }>;
}

export function personSnapshot(rows: TreeRows, person: IndividualRow): PersonConflictSnapshot {
	const eventOf = (type: string) => eventsOf(rows, 'INDIVIDUAL', person.id).find((e) => e.type === type);
	return {
		givenName: person.givenName,
		surname: person.surname,
		sex: person.sex,
		birthDate: eventOf('BIRT')?.dateRaw ?? null,
		birthPlace: eventOf('BIRT')?.place ?? null,
		deathDate: eventOf('DEAT')?.dateRaw ?? null,
		deathPlace: eventOf('DEAT')?.place ?? null
	};
}

export function unionSnapshot(rows: TreeRows, union: UnionRow): UnionConflictSnapshot {
	return {
		status: union.status as UnionStatus,
		events: eventsOf(rows, 'FAMILY', union.id)
			.filter((e) => isUnionEventType(e.type))
			.map((e) => ({ id: e.id, type: e.type, dateText: e.dateRaw, place: e.place }))
	};
}

/** Thrown when a client edited from a version that is no longer current; carries what is current. */
function staleVersion(entity: 'individual' | 'union', id: string, currentVersion: number, expected: number, current: object) {
	return new ConcurrencyConflictError(
		`This ${entity === 'individual' ? 'person' : 'partnership'} was changed by someone else (you had version ${expected}, it is now ${currentVersion}).`,
		{ reason: 'STALE_VERSION', entity, id, expectedVersion: expected, currentVersion, current }
	);
}

function checkPersonVersion(rows: TreeRows, person: IndividualRow, expected: number | undefined) {
	if (expected !== undefined && person.version !== expected) {
		throw staleVersion('individual', person.id, person.version, expected, personSnapshot(rows, person));
	}
}

function checkUnionVersion(rows: TreeRows, union: UnionRow, expected: number | undefined) {
	if (expected !== undefined && union.version !== expected) {
		throw staleVersion('union', union.id, union.version, expected, unionSnapshot(rows, union));
	}
}

function touch<T extends { version: number; updatedAt: number | null }>(row: T, ctx: OpContext): T {
	return { ...row, version: row.version + 1, updatedAt: ctx.now };
}

/** An op that bumps a person or union's version because something it owns changed. */
function bump(table: 'individuals' | 'unions', row: IndividualRow | UnionRow, ctx: OpContext): RowOp {
	return { table, id: row.id, before: row, after: touch(row, ctx) };
}

// ---- Events ----

interface EventFields {
	dateText?: string | null;
	place?: string | null;
}

/**
 * Create or update the first event of `type` on an entity. `undefined` leaves a field alone; a
 * missing event is only created when there is something to record, unless `isForced`.
 */
function upsertEvent(
	rows: TreeRows,
	ctx: OpContext,
	entityType: 'INDIVIDUAL' | 'FAMILY',
	entityId: string,
	type: string,
	fields: EventFields,
	isForced = false
): RowOp[] {
	if (fields.dateText === undefined && fields.place === undefined) return [];
	const existing = eventsOf(rows, entityType, entityId).find((e) => e.type === type);
	if (existing) {
		const dateText = fields.dateText !== undefined ? cleanText(fields.dateText) : existing.dateRaw;
		const after: EventRow = {
			...existing,
			dateRaw: dateText,
			...(fields.dateText !== undefined ? dateColumnsFor(dateText) : {}),
			place: fields.place !== undefined ? cleanText(fields.place) : existing.place
		};
		if (after.dateRaw === existing.dateRaw && after.place === existing.place) return [];
		return [{ table: 'events', id: existing.id, before: existing, after: touch(after, ctx) }];
	}
	const dateText = cleanText(fields.dateText);
	const place = cleanText(fields.place);
	if (!isForced && !dateText && !place) return [];
	return [createEvent(ctx, entityType, entityId, type, dateText, place)];
}

function createEvent(
	ctx: OpContext,
	entityType: 'INDIVIDUAL' | 'FAMILY',
	entityId: string,
	type: string,
	dateText: string | null,
	place: string | null
): RowOp {
	const id = ctx.newId();
	const row: EventRow = {
		id,
		treeId: ctx.treeId,
		entityType,
		entityId,
		type,
		dateRaw: dateText,
		...dateColumnsFor(dateText),
		place,
		description: null,
		value: null,
		cause: null,
		age: null,
		notes: null,
		sortOrder: 0,
		version: 1,
		createdAt: ctx.now,
		updatedAt: ctx.now
	};
	return { table: 'events', id, before: null, after: row };
}

/**
 * Names that say they came from `unionId` (for `personId` only, when given), rewritten to point at
 * `toUnionId`. Done here rather than by a foreign key so the change is logged and undoable.
 */
function relinkNames(rows: TreeRows, ctx: OpContext, unionId: string[], toUnionId: string | null, personId?: string): RowOp[] {
	return rows.personNames
		.filter((n) => n.unionId !== null && unionId.includes(n.unionId) && (personId === undefined || n.personId === personId))
		.map((n) => ({ table: 'person_names' as const, id: n.id, before: n as RowImage, after: touch({ ...n, unionId: toUnionId }, ctx) as RowImage }));
}

// ---- Builders, one per command ----

function createPerson(rows: TreeRows, ctx: OpContext, command: Extract<RelationshipCommand, { kind: 'create_person' }>): RowOp[] {
	const row: IndividualRow = {
		id: command.personId,
		treeId: ctx.treeId,
		xrefId: `@I_${command.personId.slice(0, 8)}@`,
		givenName: cleanText(command.givenName),
		surname: cleanText(command.surname),
		sex: command.sex,
		privacy: 'auto',
		createdBy: ctx.actorId ?? null,
		version: 1,
		createdAt: ctx.now,
		updatedAt: ctx.now
	};
	const ops: RowOp[] = [{ table: 'individuals', id: row.id, before: null, after: row }];
	// Every person gets a name row from the start, so the names section has something to edit.
	if (row.givenName || row.surname) ops.push(initialNameOp(ctx, row.id, { givenName: row.givenName, surname: row.surname }));
	for (const [type, dateText, place] of [
		['BIRT', command.birthDate, command.birthPlace],
		['DEAT', command.deathDate, command.deathPlace]
	] as const) {
		if (cleanText(dateText) || cleanText(place)) {
			ops.push(createEvent(ctx, 'INDIVIDUAL', row.id, type, cleanText(dateText), cleanText(place)));
		}
	}
	return ops;
}

function updatePerson(rows: TreeRows, ctx: OpContext, command: Extract<RelationshipCommand, { kind: 'update_person' }>): RowOp[] {
	const person = requirePerson(rows, command.personId);
	checkPersonVersion(rows, person, command.expectedVersion);

	const after: IndividualRow = {
		...person,
		givenName: command.givenName !== undefined ? cleanText(command.givenName) : person.givenName,
		surname: command.surname !== undefined ? cleanText(command.surname) : person.surname,
		sex: command.sex !== undefined ? command.sex : person.sex
	};
	const eventOps = [
		...upsertEvent(rows, ctx, 'INDIVIDUAL', person.id, 'BIRT', { dateText: command.birthDate, place: command.birthPlace }),
		...upsertEvent(rows, ctx, 'INDIVIDUAL', person.id, 'DEAT', { dateText: command.deathDate, place: command.deathPlace })
	];
	const isPersonChanged =
		after.givenName !== person.givenName || after.surname !== person.surname || after.sex !== person.sex;
	if (!isPersonChanged && eventOps.length === 0) return [];
	// The form's name fields are the preferred name row's; editing one edits the other (ADR-013).
	const nameOps = preferredNameOps(rows, ctx, person.id, { givenName: after.givenName, surname: after.surname });
	return [{ table: 'individuals', id: person.id, before: person, after: touch(after, ctx) }, ...nameOps, ...eventOps];
}

function setPersonPrivacy(rows: TreeRows, ctx: OpContext, command: Extract<RelationshipCommand, { kind: 'set_person_privacy' }>): RowOp[] {
	const person = requirePerson(rows, command.personId);
	checkPersonVersion(rows, person, command.expectedVersion);
	if (person.privacy === command.privacy) return [];
	return [{ table: 'individuals', id: person.id, before: person, after: touch({ ...person, privacy: command.privacy }, ctx) }];
}

function recordDeath(rows: TreeRows, ctx: OpContext, command: Extract<RelationshipCommand, { kind: 'record_death' }>): RowOp[] {
	const person = requirePerson(rows, command.personId);
	checkPersonVersion(rows, person, command.expectedVersion);
	// Only the person and their DEAT event change. Unions are deliberately not read here: a death
	// never ends, deletes or rewrites a partnership.
	const eventOps = upsertEvent(
		rows,
		ctx,
		'INDIVIDUAL',
		person.id,
		'DEAT',
		{ dateText: command.dateText, place: command.place },
		true
	);
	return eventOps.length === 0 ? [] : [bump('individuals', person, ctx), ...eventOps];
}

function deletePerson(rows: TreeRows, ctx: OpContext, command: Extract<RelationshipCommand, { kind: 'delete_person' }>): RowOp[] {
	const person = requirePerson(rows, command.personId);
	checkPersonVersion(rows, person, command.expectedVersion);
	const ops: RowOp[] = [];
	const remove = (table: RecordTable, row: { id: string }) => ops.push({ table, id: row.id, before: row as RowImage, after: null });

	rows.personNames.filter((n) => n.personId === person.id).forEach((n) => remove('person_names', n));
	rows.parentChild.filter((l) => l.parentId === person.id || l.childId === person.id).forEach((l) => remove('parent_child', l));
	eventsOf(rows, 'INDIVIDUAL', person.id).forEach((e) => remove('events', e));
	rows.mediaItems.filter((m) => m.entityId === person.id).forEach((m) => remove('media_items', m));

	for (const membership of rows.unionPartners.filter((p) => p.personId === person.id)) {
		remove('union_partners', membership);
		const union = requireUnion(rows, membership.unionId);
		const remaining = partnerIdsOf(rows, union.id).filter((id) => id !== person.id);
		if (remaining.length > 0) {
			// The partnership lives on with whoever is left; its version moves because its partners changed.
			ops.push(bump('unions', union, ctx));
		} else {
			// Nobody left in it: the union, its own events, and any links still filed under it go too.
			// Links are kept as direct parent links where the parent is someone other than the deleted person.
			eventsOf(rows, 'FAMILY', union.id).forEach((e) => remove('events', e));
			for (const link of rows.parentChild.filter((l) => l.unionId === union.id && l.parentId !== person.id && l.childId !== person.id)) {
				ops.push({ table: 'parent_child', id: link.id, before: link, after: touch({ ...link, unionId: null }, ctx) });
			}
			remove('unions', union);
		}
	}
	remove('individuals', person);
	return ops;
}

function createUnion(rows: TreeRows, ctx: OpContext, command: Extract<RelationshipCommand, { kind: 'create_union' }>): RowOp[] {
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

function addPartner(rows: TreeRows, ctx: OpContext, command: Extract<RelationshipCommand, { kind: 'add_partner_to_union' }>): RowOp[] {
	const union = requireUnion(rows, command.unionId);
	requirePerson(rows, command.personId);
	const members = rows.unionPartners.filter((p) => p.unionId === union.id);
	if (members.some((p) => p.personId === command.personId)) return [];
	const id = ctx.newId();
	const order = members.reduce((max, p) => Math.max(max, p.order), -1) + 1;
	const partner: UnionPartnerRow = { id, unionId: union.id, personId: command.personId, order, createdAt: ctx.now };
	return [bump('unions', union, ctx), { table: 'union_partners', id, before: null, after: partner }];
}

function removePartner(rows: TreeRows, ctx: OpContext, command: Extract<RelationshipCommand, { kind: 'remove_partner_from_union' }>): RowOp[] {
	const union = requireUnion(rows, command.unionId);
	checkUnionVersion(rows, union, command.expectedVersion);
	const membership = rows.unionPartners.find((p) => p.unionId === union.id && p.personId === command.personId);
	if (!membership) throw new NotFoundError('Partner', command.personId);
	// A name that came from this partnership no longer has a partner in it to have come from.
	return [bump('unions', union, ctx), { table: 'union_partners', id: membership.id, before: membership, after: null }, ...relinkNames(rows, ctx, [union.id], null, command.personId)];
}

function assertParentChild(rows: TreeRows, ctx: OpContext, command: Extract<RelationshipCommand, { kind: 'assert_parent_child' }>): RowOp[] {
	requirePerson(rows, command.parentId);
	requirePerson(rows, command.childId);
	if (command.unionId) requireUnion(rows, command.unionId);
	const existing = rows.parentChild.map(asParentChild);
	const violations = validateParentChildAssertion(
		{ parentId: command.parentId, childId: command.childId, type: command.type, unionId: command.unionId },
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

function removeParentChild(rows: TreeRows, _ctx: OpContext, command: Extract<RelationshipCommand, { kind: 'remove_parent_child' }>): RowOp[] {
	const link = rows.parentChild.find(
		(l) => l.parentId === command.parentId && l.childId === command.childId && l.type === command.type
	);
	if (!link) throw new NotFoundError('Parent link');
	return [{ table: 'parent_child', id: link.id, before: link, after: null }];
}

function changeParentChildType(rows: TreeRows, ctx: OpContext, command: Extract<RelationshipCommand, { kind: 'change_parent_child_type' }>): RowOp[] {
	const link = rows.parentChild.find((l) => l.parentId === command.parentId && l.childId === command.childId && l.type === command.fromType);
	if (!link) throw new NotFoundError('Parent link');
	if (command.fromType === command.toType) return [];
	if (rows.parentChild.some((l) => l.parentId === command.parentId && l.childId === command.childId && l.type === command.toType)) {
		throw new ValidationError('That parent is already recorded with this type for this child');
	}
	// The raw PEDI word only qualified the old type (sealing, other); it says nothing about the new one.
	return [{ table: 'parent_child', id: link.id, before: link, after: touch({ ...link, type: command.toType, gedcomPedi: null }, ctx) }];
}

function destroyUnion(rows: TreeRows, ctx: OpContext, command: Extract<RelationshipCommand, { kind: 'destroy_union' }>): RowOp[] {
	const union = requireUnion(rows, command.unionId);
	checkUnionVersion(rows, union, command.expectedVersion);
	const ops: RowOp[] = [];
	rows.unionPartners.filter((p) => p.unionId === union.id).forEach((p) => ops.push({ table: 'union_partners', id: p.id, before: p, after: null }));
	eventsOf(rows, 'FAMILY', union.id).forEach((e) => ops.push({ table: 'events', id: e.id, before: e, after: null }));
	// Parentage is a fact about the parent and child, not about the partnership, so the links stay
	// and only lose their grouping. Deleting them would erase who someone's parents were.
	for (const link of rows.parentChild.filter((l) => l.unionId === union.id)) {
		ops.push({ table: 'parent_child', id: link.id, before: link, after: touch({ ...link, unionId: null }, ctx) });
	}
	ops.push(...relinkNames(rows, ctx, [union.id], null));
	ops.push({ table: 'unions', id: union.id, before: union, after: null });
	return ops;
}

function endUnion(rows: TreeRows, ctx: OpContext, command: Extract<RelationshipCommand, { kind: 'end_union' }>): RowOp[] {
	const union = requireUnion(rows, command.unionId);
	checkUnionVersion(rows, union, command.expectedVersion);
	if (!(ENDED_UNION_STATUSES as readonly string[]).includes(command.status)) {
		throw new ValidationError(`'${command.status}' is not an ending status`);
	}
	const eventOps = command.event
		? upsertEvent(rows, ctx, 'FAMILY', union.id, command.event.type, { dateText: command.event.dateText, place: command.event.place }, true)
		: [];
	const isStatusChanged = union.status !== command.status;
	if (!isStatusChanged && eventOps.length === 0) return [];
	return [{ table: 'unions', id: union.id, before: union, after: touch({ ...union, status: command.status }, ctx) }, ...eventOps];
}

function updateUnion(rows: TreeRows, ctx: OpContext, command: Extract<RelationshipCommand, { kind: 'update_union' }>): RowOp[] {
	const union = requireUnion(rows, command.unionId);
	checkUnionVersion(rows, union, command.expectedVersion);

	const eventOps: RowOp[] = [];
	if (command.events) {
		const editable = eventsOf(rows, 'FAMILY', union.id).filter((e) => isUnionEventType(e.type));
		const submittedIds = new Set(command.events.map((e) => e.id).filter(Boolean));
		for (const input of command.events) {
			if (!isUnionEventType(input.type)) throw new ValidationError(`'${input.type}' is not a partnership event`);
			if (!input.id) {
				eventOps.push(createEvent(ctx, 'FAMILY', union.id, input.type, cleanText(input.dateText), cleanText(input.place)));
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
			const isChanged = after.type !== existing.type || after.dateRaw !== existing.dateRaw || after.place !== existing.place;
			if (isChanged) eventOps.push({ table: 'events', id: existing.id, before: existing, after: touch(after, ctx) });
		}
		// An event the editor showed but no longer submits was removed by the person editing.
		for (const existing of editable) {
			if (!submittedIds.has(existing.id)) eventOps.push({ table: 'events', id: existing.id, before: existing, after: null });
		}
	}

	const status = command.status ?? (union.status as UnionStatus);
	if (status === union.status && eventOps.length === 0) return [];
	return [{ table: 'unions', id: union.id, before: union, after: touch({ ...union, status }, ctx) }, ...eventOps];
}

/** The union's facts in the shape the merge rules compare. */
export function mergeableUnion(rows: TreeRows, union: UnionRow): MergeableUnion {
	return {
		id: union.id,
		status: union.status,
		facts: eventsOf(rows, 'FAMILY', union.id).map(
			(e): MergeFact => ({ type: e.type, dateText: e.dateRaw, place: e.place, description: e.description })
		)
	};
}

/** Every disagreement between these unions, before any choice is applied. */
export function mergeConflictsOf(rows: TreeRows, unionIds: string[]): MergeConflict[] {
	return findMergeConflicts(unionIds.map((id) => mergeableUnion(rows, requireUnion(rows, id))));
}

/** Other unions with exactly this union's partners: the candidates for merging it into one. */
export function samePartnerUnionIds(rows: TreeRows, unionId: string): string[] {
	const key = partnerSetKey(partnerIdsOf(rows, unionId));
	if (!key) return [];
	return rows.unions.filter((u) => u.id !== unionId && partnerSetKey(partnerIdsOf(rows, u.id)) === key).map((u) => u.id);
}

/** An imported union's id is `<treeId>:<xref>`; anything else was never known by an XREF. */
function xrefOf(treeId: string, unionId: string): string | null {
	const prefix = `${treeId}:`;
	return unionId.startsWith(prefix) ? unionId.slice(prefix.length) : null;
}

function mergeUnions(rows: TreeRows, ctx: OpContext, command: Extract<RelationshipCommand, { kind: 'merge_unions' }>): RowOp[] {
	const mergedIds = [...new Set(command.mergedIds)].filter((id) => id !== command.survivorId);
	if (mergedIds.length === 0) throw new ValidationError('Choose at least two partnerships to merge');

	const survivor = requireUnion(rows, command.survivorId);
	const merged = mergedIds.map((id) => requireUnion(rows, id));
	const involved = [survivor, ...merged];
	for (const union of involved) checkUnionVersion(rows, union, command.expectedVersions?.[union.id]);

	const key = partnerSetKey(partnerIdsOf(rows, survivor.id));
	if (!key || involved.some((u) => partnerSetKey(partnerIdsOf(rows, u.id)) !== key)) {
		throw new ValidationError('Only partnerships between exactly the same people can be merged');
	}

	// Never pick between two different facts on the person's behalf.
	const conflicts = mergeConflictsOf(rows, involved.map((u) => u.id));
	const unresolved = unresolvedConflicts(conflicts, command.keep);
	if (unresolved.length > 0) {
		throw new UnionMergeConflictError('These partnerships record different facts; choose which to keep for each.', unresolved);
	}
	const keptStatusFrom = command.keep?.status ? requireUnion(rows, command.keep.status) : survivor;

	const ops: RowOp[] = [];
	const mergedSet = new Set(mergedIds);

	// Events: the survivor's stay; a merged union's move over unless the survivor already states the
	// same fact, or a conflict was settled in favour of another union.
	const chosenFor = (type: string) => command.keep?.events?.[type];
	const seen = new Set<string>();
	for (const union of involved) {
		for (const event of eventsOf(rows, 'FAMILY', union.id)) {
			const chosen = conflicts.some((c) => c.kind === 'event' && c.eventType === event.type) ? chosenFor(event.type) : undefined;
			const isLoser = chosen !== undefined && chosen !== union.id;
			const factSeen = seen.has(factKey({ type: event.type, dateText: event.dateRaw, place: event.place, description: event.description }));
			if (isLoser || (union.id !== survivor.id && factSeen)) {
				ops.push({ table: 'events', id: event.id, before: event, after: null });
				continue;
			}
			seen.add(factKey({ type: event.type, dateText: event.dateRaw, place: event.place, description: event.description }));
			if (union.id !== survivor.id) {
				ops.push({ table: 'events', id: event.id, before: event, after: touch({ ...event, entityId: survivor.id }, ctx) });
			}
		}
	}

	// Parentage is a fact about parent and child, so every link is kept and only regrouped.
	for (const link of rows.parentChild.filter((l) => l.unionId !== null && mergedSet.has(l.unionId))) {
		ops.push({ table: 'parent_child', id: link.id, before: link, after: touch({ ...link, unionId: survivor.id }, ctx) });
	}

	// The partner rows repeat the survivor's, and (union, person) is unique, so they are deleted, not moved.
	for (const partner of rows.unionPartners.filter((p) => mergedSet.has(p.unionId))) {
		ops.push({ table: 'union_partners', id: partner.id, before: partner, after: null });
	}

	ops.push(...relinkNames(rows, ctx, mergedIds, survivor.id));

	const aliases = [...(survivor.xrefAliases ?? [])];
	for (const union of merged) {
		for (const alias of [xrefOf(ctx.treeId, union.id), ...(union.xrefAliases ?? [])]) {
			if (alias && alias !== xrefOf(ctx.treeId, survivor.id) && !aliases.includes(alias)) aliases.push(alias);
		}
		ops.push({ table: 'unions', id: union.id, before: union, after: null });
	}
	ops.push({
		table: 'unions',
		id: survivor.id,
		before: survivor,
		after: touch({ ...survivor, status: keptStatusFrom.status, xrefAliases: aliases.length > 0 ? aliases : null }, ctx)
	});
	return ops;
}

/** Ops for one command against the tree as it currently is. */
export function buildOps(rows: TreeRows, command: RelationshipCommand, ctx: OpContext): RowOp[] {
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
		case 'rewrite_place':
			return buildPlaceOps(rows, command, ctx);
		case 'create_person':
			return createPerson(rows, ctx, command);
		case 'update_person':
			return updatePerson(rows, ctx, command);
		case 'delete_person':
			return deletePerson(rows, ctx, command);
		case 'set_person_privacy':
			return setPersonPrivacy(rows, ctx, command);
		case 'record_death':
			return recordDeath(rows, ctx, command);
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

/** Ops for a whole plan; each command sees the rows the earlier ones produced. */
export function buildPlanOps(rows: TreeRows, commands: RelationshipCommand[], ctx: OpContext): RowOp[] {
	let working = rows;
	const all: RowOp[] = [];
	for (const command of commands) {
		const ops = buildOps(working, command, ctx);
		all.push(...ops);
		working = applyOpsToRows(working, ops);
	}
	return mergeOps(all);
}

export { ENTITY_TYPES };
export type { UnionEventInput, UnionEventType };
