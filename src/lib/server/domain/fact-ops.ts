/**
 * Row operations for a person's facts (Phase 3 fact editor): create, edit, delete and reorder.
 *
 * Facts are addressed by their own id, never by type. The birth and death fields on the person
 * form go through `upsertEvent`, which acts on the first event of a type; that is right for a form
 * with one birth field and wrong for a person with two recorded births, where it would overwrite
 * whichever came first. Nothing here matches on type, so a repeated or conflicting fact is edited
 * only when someone edits that fact.
 */

import type { EventRow, IndividualRow, RowOp, TreeRows } from './change-log';
import { dateColumnsFor } from './date-columns';
import { ConcurrencyConflictError, NotFoundError, ValidationError } from './errors';
import { isFactType, type FactInput } from '../../shared/fact-types';
import { isUnionEventType } from '../../shared/union-events';

export type FactCommand =
	| { kind: 'create_fact'; personId: string; factId: string; fact: FactInput }
	| {
			kind: 'update_fact';
			factId: string;
			/** The version the editor loaded; a newer stored version is a conflict. */
			expectedVersion?: number;
			/** Only the fields to change; the rest are left as they are. */
			fact: Partial<FactInput>;
	  }
	| { kind: 'delete_fact'; factId: string; expectedVersion?: number }
	| {
			kind: 'reorder_facts';
			personId: string;
			/** The person's facts in the order they should now sort among equals. */
			orderedFactIds: string[];
	  };

interface FactContext {
	treeId: string;
	/** Epoch milliseconds, stamped on every row written. */
	now: number;
}

const clean = (value: string | null | undefined): string | null => value?.trim() || null;

/** Vitals are on the person form too, so changing one must make a stale form conflict. */
const VITAL_TYPES = new Set(['BIRT', 'DEAT']);

function requirePerson(rows: TreeRows, id: string): IndividualRow {
	const person = rows.individuals.find((p) => p.id === id);
	if (!person) throw new NotFoundError('Person', id);
	return person;
}

function requireFact(rows: TreeRows, id: string): EventRow {
	const fact = rows.events.find((e) => e.id === id);
	if (!fact || fact.entityType !== 'INDIVIDUAL' || isUnionEventType(fact.type))
		throw new NotFoundError('Fact', id);
	return fact;
}

function requireKnownType(type: string): void {
	if (!isFactType(type)) throw new ValidationError(`'${type}' is not a fact type`);
}

/** What the conflict dialog can show as the stored fact. */
function factSnapshot(fact: EventRow): Record<string, unknown> {
	return {
		type: fact.type,
		dateText: fact.dateRaw,
		place: fact.place,
		value: fact.value,
		cause: fact.cause,
		age: fact.age,
		notes: fact.notes ?? fact.description
	};
}

function checkVersion(fact: EventRow, expected: number | undefined): void {
	if (expected === undefined || fact.version === expected) return;
	throw new ConcurrencyConflictError(
		`This fact was changed by someone else (you had version ${expected}, it is now ${fact.version}).`,
		{
			reason: 'STALE_VERSION',
			entity: 'fact',
			id: fact.id,
			expectedVersion: expected,
			currentVersion: fact.version,
			current: factSnapshot(fact)
		}
	);
}

function touch(row: EventRow, ctx: FactContext): EventRow {
	return { ...row, version: row.version + 1, updatedAt: ctx.now };
}

/** The person's version moves when a vital changes, exactly as `record_death` does. */
function bumpPerson(rows: TreeRows, personId: string, ctx: FactContext): RowOp[] {
	const person = requirePerson(rows, personId);
	return [
		{
			table: 'individuals',
			id: person.id,
			before: person,
			after: { ...person, version: person.version + 1, updatedAt: ctx.now }
		}
	];
}

function createFact(
	rows: TreeRows,
	ctx: FactContext,
	command: Extract<FactCommand, { kind: 'create_fact' }>
): RowOp[] {
	requirePerson(rows, command.personId);
	requireKnownType(command.fact.type);
	const dateText = clean(command.fact.dateText);
	const row: EventRow = {
		id: command.factId,
		treeId: ctx.treeId,
		gedcomExtra: null,
		entityType: 'INDIVIDUAL',
		entityId: command.personId,
		type: command.fact.type,
		dateRaw: dateText,
		...dateColumnsFor(dateText),
		place: clean(command.fact.place),
		description: null,
		value: clean(command.fact.value),
		cause: clean(command.fact.cause),
		age: clean(command.fact.age),
		notes: clean(command.fact.notes),
		sortOrder: 0,
		version: 1,
		createdAt: ctx.now,
		updatedAt: ctx.now
	};
	const vitals = VITAL_TYPES.has(row.type) ? bumpPerson(rows, command.personId, ctx) : [];
	return [{ table: 'events', id: row.id, before: null, after: row }, ...vitals];
}

function updateFact(
	rows: TreeRows,
	ctx: FactContext,
	command: Extract<FactCommand, { kind: 'update_fact' }>
): RowOp[] {
	const before = requireFact(rows, command.factId);
	checkVersion(before, command.expectedVersion);
	const patch = command.fact;
	if (patch.type !== undefined) requireKnownType(patch.type);

	const after: EventRow = {
		...before,
		type: patch.type ?? before.type,
		// Unchanged text keeps its columns as they are, so re-saving a form is not a write.
		...(patch.dateText !== undefined && clean(patch.dateText) !== before.dateRaw
			? { dateRaw: clean(patch.dateText), ...dateColumnsFor(clean(patch.dateText)) }
			: {}),
		place: patch.place !== undefined ? clean(patch.place) : before.place,
		value: patch.value !== undefined ? clean(patch.value) : before.value,
		cause: patch.cause !== undefined ? clean(patch.cause) : before.cause,
		age: patch.age !== undefined ? clean(patch.age) : before.age,
		notes: patch.notes !== undefined ? clean(patch.notes) : before.notes
	};
	// A legacy description is the imported cause, note or value in one. Once the fact is edited its
	// text lives in the field that says what it is, and `notes` must not repeat it on export.
	if (patch.notes !== undefined || patch.value !== undefined || patch.cause !== undefined) {
		after.notes =
			patch.notes !== undefined ? clean(patch.notes) : (before.notes ?? before.description);
		after.description = null;
	}
	if (JSON.stringify(after) === JSON.stringify(before)) return [];
	const isVital = VITAL_TYPES.has(before.type) || VITAL_TYPES.has(after.type);
	return [
		{ table: 'events', id: before.id, before, after: touch(after, ctx) },
		...(isVital ? bumpPerson(rows, before.entityId, ctx) : [])
	];
}

function deleteFact(
	rows: TreeRows,
	ctx: FactContext,
	command: Extract<FactCommand, { kind: 'delete_fact' }>
): RowOp[] {
	const before = requireFact(rows, command.factId);
	checkVersion(before, command.expectedVersion);
	const vitals = VITAL_TYPES.has(before.type) ? bumpPerson(rows, before.entityId, ctx) : [];
	return [{ table: 'events', id: before.id, before, after: null }, ...vitals];
}

function reorderFacts(
	rows: TreeRows,
	ctx: FactContext,
	command: Extract<FactCommand, { kind: 'reorder_facts' }>
): RowOp[] {
	requirePerson(rows, command.personId);
	const ids = command.orderedFactIds;
	if (new Set(ids).size !== ids.length)
		throw new ValidationError('A fact appears twice in the new order');
	const ops: RowOp[] = [];
	ids.forEach((id, index) => {
		const fact = requireFact(rows, id);
		if (fact.entityId !== command.personId)
			throw new ValidationError('A fact in the new order belongs to someone else');
		if (fact.sortOrder !== index)
			ops.push({
				table: 'events',
				id,
				before: fact,
				after: touch({ ...fact, sortOrder: index }, ctx)
			});
	});
	return ops;
}

export function buildFactOps(rows: TreeRows, command: FactCommand, ctx: FactContext): RowOp[] {
	switch (command.kind) {
		case 'create_fact':
			return createFact(rows, ctx, command);
		case 'update_fact':
			return updateFact(rows, ctx, command);
		case 'delete_fact':
			return deleteFact(rows, ctx, command);
		case 'reorder_facts':
			return reorderFacts(rows, ctx, command);
	}
}
