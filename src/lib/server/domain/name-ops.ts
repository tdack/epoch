/**
 * Row operations for a person's names (Phase 3, S6): create, edit, delete, reorder and choose the
 * preferred one.
 *
 * The preferred name drives the person's display name, which is stored on `individuals`
 * (`given_name`, `surname`) because cards, search and the drawer read it there. Every op that can
 * change which name is preferred, or what it says, also plans the update to `individuals` in the
 * same list, so the two cannot drift and one undo restores both. The person's version moves only
 * when the display name does (as ADR-012 does for facts), so undoing an earlier person edit stays
 * possible after a name is added.
 */

import type { IndividualRow, PersonNameRow, RowOp, TreeRows } from './change-log';
import { dateColumnsFor } from './date-columns';
import { ConcurrencyConflictError, NotFoundError, ValidationError } from './errors';
import { isNameType, NAME_TYPES, type NameInput } from '../../shared/name-types';

export type NameCommand =
	| {
			kind: 'create_name';
			personId: string;
			nameId: string;
			name: NameInput;
			isPreferred?: boolean;
	  }
	| {
			kind: 'update_name';
			nameId: string;
			/** The version the editor loaded; a newer stored version is a conflict. */
			expectedVersion?: number;
			/** Only the fields to change; the rest are left as they are. */
			name: Partial<NameInput>;
	  }
	| { kind: 'delete_name'; nameId: string; expectedVersion?: number }
	| { kind: 'reorder_names'; personId: string; orderedNameIds: string[] }
	| { kind: 'set_preferred_name'; personId: string; nameId: string; expectedVersion?: number };

export interface NameContext {
	treeId: string;
	/** Epoch milliseconds, stamped on every row written. */
	now: number;
	newId: () => string;
}

const clean = (value: string | null | undefined): string | null => value?.trim() || null;

function requirePerson(rows: TreeRows, id: string): IndividualRow {
	const person = rows.individuals.find((p) => p.id === id);
	if (!person) throw new NotFoundError('Person', id);
	return person;
}

function requireName(rows: TreeRows, id: string): PersonNameRow {
	const name = rows.personNames.find((n) => n.id === id);
	if (!name) throw new NotFoundError('Name', id);
	return name;
}

const namesOf = (rows: TreeRows, personId: string) =>
	rows.personNames.filter((n) => n.personId === personId).sort((a, b) => a.order - b.order);

/** What the conflict dialog can show as the stored name. */
export function nameSnapshot(name: PersonNameRow): Record<string, unknown> {
	return {
		type: name.type,
		givenName: name.givenName,
		surname: name.surname,
		prefix: name.namePrefix,
		suffix: name.nameSuffix,
		nickname: name.nickname,
		surnamePrefix: name.surnamePrefix,
		dateText: name.dateRaw,
		isPreferred: name.isPreferred
	};
}

function checkVersion(name: PersonNameRow, expected: number | undefined): void {
	if (expected === undefined || name.version === expected) return;
	throw new ConcurrencyConflictError(
		`This name was changed by someone else (you had version ${expected}, it is now ${name.version}).`,
		{
			reason: 'STALE_VERSION',
			entity: 'name',
			id: name.id,
			expectedVersion: expected,
			currentVersion: name.version,
			current: nameSnapshot(name)
		}
	);
}

const touch = (row: PersonNameRow, ctx: NameContext): PersonNameRow => ({
	...row,
	version: row.version + 1,
	updatedAt: ctx.now
});

function hasContent(
	name: Pick<
		PersonNameRow,
		'givenName' | 'surname' | 'namePrefix' | 'nameSuffix' | 'nickname' | 'surnamePrefix'
	>
): boolean {
	return Boolean(
		name.givenName ||
		name.surname ||
		name.namePrefix ||
		name.nameSuffix ||
		name.nickname ||
		name.surnamePrefix
	);
}

/** The union must exist and name the person as a partner; a name cannot come from someone else's marriage. */
function checkUnionLink(rows: TreeRows, personId: string, unionId: string | null): void {
	if (!unionId) return;
	if (!rows.unionPartners.some((p) => p.unionId === unionId && p.personId === personId)) {
		throw new ValidationError('A name can only be linked to a partnership the person is in');
	}
}

function blankRow(ctx: NameContext, id: string, personId: string): PersonNameRow {
	return {
		id,
		personId,
		type: NAME_TYPES.BIRTH,
		givenName: null,
		surname: null,
		namePrefix: null,
		nameSuffix: null,
		nickname: null,
		surnamePrefix: null,
		gedcomType: null,
		gedcomExtra: null,
		dateRaw: null,
		dateSort: null,
		dateSortEnd: null,
		dateQualifier: null,
		datePrecision: null,
		dateCalendar: null,
		unionId: null,
		isPreferred: false,
		order: 0,
		version: 1,
		createdAt: ctx.now,
		updatedAt: ctx.now
	};
}

/** Fields of the editor's input, written onto a row; `undefined` fields are left as they are. */
function withInput(row: PersonNameRow, input: Partial<NameInput>): PersonNameRow {
	const next: PersonNameRow = { ...row };
	if (input.type !== undefined) {
		next.type = input.type;
		// A free-text word only qualified the old type; it says nothing about the new one.
		if (input.type !== row.type) next.gedcomType = null;
	}
	if (input.givenName !== undefined) next.givenName = clean(input.givenName);
	if (input.surname !== undefined) next.surname = clean(input.surname);
	if (input.prefix !== undefined) next.namePrefix = clean(input.prefix);
	if (input.suffix !== undefined) next.nameSuffix = clean(input.suffix);
	if (input.nickname !== undefined) next.nickname = clean(input.nickname);
	if (input.surnamePrefix !== undefined) next.surnamePrefix = clean(input.surnamePrefix);
	// Unchanged text keeps its columns, so re-saving a form is not a write.
	if (input.dateText !== undefined && clean(input.dateText) !== row.dateRaw) {
		Object.assign(next, {
			dateRaw: clean(input.dateText),
			...dateColumnsFor(clean(input.dateText))
		});
	}
	if (input.unionId !== undefined) next.unionId = input.unionId || null;
	return next;
}

function checkInput(input: Partial<NameInput>): void {
	if (input.type !== undefined && !isNameType(input.type))
		throw new ValidationError(`'${input.type}' is not a name type`);
}

/**
 * Ops that make `individuals` say what the preferred name says. `after` is the person's names once
 * the other ops are applied. A person with no stored names keeps the fields they have.
 */
function displaySyncOps(person: IndividualRow, after: PersonNameRow[], ctx: NameContext): RowOp[] {
	const preferred = after.find((n) => n.isPreferred);
	if (!preferred) return [];
	if (preferred.givenName === person.givenName && preferred.surname === person.surname) return [];
	return [
		{
			table: 'individuals',
			id: person.id,
			before: person,
			after: {
				...person,
				givenName: preferred.givenName,
				surname: preferred.surname,
				version: person.version + 1,
				updatedAt: ctx.now
			}
		}
	];
}

/**
 * A person the editor created has no name row; their name fields are their only name. The first
 * name command gives them a row that says the same, preferred, so there is something to reorder.
 */
function materialisedRow(rows: TreeRows, ctx: NameContext, person: IndividualRow): RowOp[] {
	if (namesOf(rows, person.id).length > 0) return [];
	const row: PersonNameRow = {
		...blankRow(ctx, ctx.newId(), person.id),
		givenName: person.givenName,
		surname: person.surname,
		isPreferred: true
	};
	return [{ table: 'person_names', id: row.id, before: null, after: row }];
}

function applyNameOps(current: PersonNameRow[], ops: RowOp[]): PersonNameRow[] {
	const byId = new Map(current.map((n) => [n.id, n]));
	for (const op of ops) {
		if (op.table !== 'person_names') continue;
		if (op.after) byId.set(op.id, op.after as PersonNameRow);
		else byId.delete(op.id);
	}
	return [...byId.values()];
}

/** Demote whichever name is preferred, other than `except`. */
function demoteOthers(names: PersonNameRow[], except: string, ctx: NameContext): RowOp[] {
	return names
		.filter((n) => n.isPreferred && n.id !== except)
		.map((n) => ({
			table: 'person_names' as const,
			id: n.id,
			before: n,
			after: touch({ ...n, isPreferred: false }, ctx)
		}));
}

function createName(
	rows: TreeRows,
	ctx: NameContext,
	command: Extract<NameCommand, { kind: 'create_name' }>
): RowOp[] {
	const person = requirePerson(rows, command.personId);
	checkInput(command.name);
	if (rows.personNames.some((n) => n.id === command.nameId))
		throw new ValidationError('That name already exists');
	const existing = materialisedRow(rows, ctx, person);
	const current = applyNameOps(namesOf(rows, person.id), existing);
	const row = withInput(
		{
			...blankRow(ctx, command.nameId, person.id),
			order: current.reduce((max, n) => Math.max(max, n.order), -1) + 1
		},
		command.name
	);
	if (!hasContent(row)) throw new ValidationError('A name needs at least one part');
	checkUnionLink(rows, person.id, row.unionId);
	row.isPreferred = Boolean(command.isPreferred);
	const ops: RowOp[] = [
		...existing,
		{ table: 'person_names', id: row.id, before: null, after: row }
	];
	if (row.isPreferred) ops.push(...demoteOthers(current, row.id, ctx));
	return [...ops, ...displaySyncOps(person, applyNameOps(current, ops), ctx)];
}

function updateName(
	rows: TreeRows,
	ctx: NameContext,
	command: Extract<NameCommand, { kind: 'update_name' }>
): RowOp[] {
	const before = requireName(rows, command.nameId);
	checkVersion(before, command.expectedVersion);
	checkInput(command.name);
	const after = withInput(before, command.name);
	if (!hasContent(after)) throw new ValidationError('A name needs at least one part');
	checkUnionLink(rows, before.personId, after.unionId);
	if (JSON.stringify(after) === JSON.stringify(before)) return [];
	const ops: RowOp[] = [{ table: 'person_names', id: before.id, before, after: touch(after, ctx) }];
	const person = requirePerson(rows, before.personId);
	return [...ops, ...displaySyncOps(person, applyNameOps(namesOf(rows, person.id), ops), ctx)];
}

function deleteName(
	rows: TreeRows,
	ctx: NameContext,
	command: Extract<NameCommand, { kind: 'delete_name' }>
): RowOp[] {
	const before = requireName(rows, command.nameId);
	checkVersion(before, command.expectedVersion);
	const person = requirePerson(rows, before.personId);
	const all = namesOf(rows, person.id);
	if (all.length === 1)
		throw new ValidationError('A person needs a name; edit it instead of removing it');
	const ops: RowOp[] = [{ table: 'person_names', id: before.id, before, after: null }];
	if (before.isPreferred) {
		// The next name in order takes over, so there is always exactly one preferred name.
		const next = all.find((n) => n.id !== before.id)!;
		ops.push({
			table: 'person_names',
			id: next.id,
			before: next,
			after: touch({ ...next, isPreferred: true }, ctx)
		});
	}
	return [...ops, ...displaySyncOps(person, applyNameOps(all, ops), ctx)];
}

function reorderNames(
	rows: TreeRows,
	ctx: NameContext,
	command: Extract<NameCommand, { kind: 'reorder_names' }>
): RowOp[] {
	requirePerson(rows, command.personId);
	const ids = command.orderedNameIds;
	if (new Set(ids).size !== ids.length)
		throw new ValidationError('A name appears twice in the new order');
	if (ids.length !== namesOf(rows, command.personId).length)
		throw new ValidationError('The new order must list every name of the person');
	const ops: RowOp[] = [];
	ids.forEach((id, index) => {
		const name = requireName(rows, id);
		if (name.personId !== command.personId)
			throw new ValidationError('A name in the new order belongs to someone else');
		if (name.order !== index)
			ops.push({
				table: 'person_names',
				id,
				before: name,
				after: touch({ ...name, order: index }, ctx)
			});
	});
	return ops;
}

function setPreferredName(
	rows: TreeRows,
	ctx: NameContext,
	command: Extract<NameCommand, { kind: 'set_preferred_name' }>
): RowOp[] {
	const person = requirePerson(rows, command.personId);
	const name = requireName(rows, command.nameId);
	if (name.personId !== person.id) throw new ValidationError('That name belongs to someone else');
	checkVersion(name, command.expectedVersion);
	if (name.isPreferred) return [];
	const all = namesOf(rows, person.id);
	const ops: RowOp[] = [
		...demoteOthers(all, name.id, ctx),
		{
			table: 'person_names',
			id: name.id,
			before: name,
			after: touch({ ...name, isPreferred: true }, ctx)
		}
	];
	return [...ops, ...displaySyncOps(person, applyNameOps(all, ops), ctx)];
}

/**
 * Editing the person form's given name and surname edits the preferred name row, so the two never
 * drift: the row is the source and `individuals` its mirror. Returns no ops for a person without
 * stored names, whose fields are their only name.
 */
export function preferredNameOps(
	rows: TreeRows,
	ctx: Pick<NameContext, 'now'>,
	personId: string,
	fields: { givenName: string | null; surname: string | null }
): RowOp[] {
	const preferred = namesOf(rows, personId).find((n) => n.isPreferred);
	if (
		!preferred ||
		(preferred.givenName === fields.givenName && preferred.surname === fields.surname)
	)
		return [];
	return [
		{
			table: 'person_names',
			id: preferred.id,
			before: preferred,
			after: { ...preferred, ...fields, version: preferred.version + 1, updatedAt: ctx.now }
		}
	];
}

/** The row an editor-created person is given, so every person has a name row from the start. */
export function initialNameOp(
	ctx: NameContext,
	personId: string,
	fields: { givenName: string | null; surname: string | null }
): RowOp {
	const row: PersonNameRow = {
		...blankRow(ctx, ctx.newId(), personId),
		...fields,
		isPreferred: true
	};
	return { table: 'person_names', id: row.id, before: null, after: row };
}

export function buildNameOps(rows: TreeRows, command: NameCommand, ctx: NameContext): RowOp[] {
	switch (command.kind) {
		case 'create_name':
			return createName(rows, ctx, command);
		case 'update_name':
			return updateName(rows, ctx, command);
		case 'delete_name':
			return deleteName(rows, ctx, command);
		case 'reorder_names':
			return reorderNames(rows, ctx, command);
		case 'set_preferred_name':
			return setPreferredName(rows, ctx, command);
	}
}
