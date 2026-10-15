/**
 * Row operations for people (create, edit, privacy, death, delete). Split out of `tree-ops.ts`
 * beside the other `*-ops` modules; `tree-ops.ts` dispatches to `buildPersonOps`.
 */

import type { IndividualRow, RecordTable, RowOp, TableRows, TreeRows } from './change-log';
import { rowOp } from './change-log';
import { preferredNameOps, initialNameOp } from './name-ops';
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

export type PersonCommand = Extract<
	RelationshipCommand,
	{
		kind:
			'create_person' | 'update_person' | 'delete_person' | 'set_person_privacy' | 'record_death';
	}
>;

/** Ops for one person command against the tree as it currently is. */
export function buildPersonOps(rows: TreeRows, command: PersonCommand, ctx: OpContext): RowOp[] {
	switch (command.kind) {
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
	}
}

/** What the conflict dialog shows as "current": the editable fields of a person. */
interface PersonConflictSnapshot {
	givenName: string | null;
	surname: string | null;
	sex: string | null;
	birthDate: string | null;
	birthPlace: string | null;
	deathDate: string | null;
	deathPlace: string | null;
}

function personSnapshot(rows: TreeRows, person: IndividualRow): PersonConflictSnapshot {
	const eventOf = (type: string) =>
		eventsOf(rows, 'INDIVIDUAL', person.id).find((e) => e.type === type);
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

function checkPersonVersion(rows: TreeRows, person: IndividualRow, expected: number | undefined) {
	if (expected !== undefined && person.version !== expected) {
		throw staleVersion(
			'individual',
			person.id,
			person.version,
			expected,
			personSnapshot(rows, person)
		);
	}
}

function createPerson(
	rows: TreeRows,
	ctx: OpContext,
	command: Extract<RelationshipCommand, { kind: 'create_person' }>
): RowOp[] {
	const row: IndividualRow = {
		id: command.personId,
		treeId: ctx.treeId,
		xrefId: `@I_${command.personId.slice(0, 8)}@`,
		xrefAliases: null,
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
	if (row.givenName || row.surname)
		ops.push(initialNameOp(ctx, row.id, { givenName: row.givenName, surname: row.surname }));
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

function updatePerson(
	rows: TreeRows,
	ctx: OpContext,
	command: Extract<RelationshipCommand, { kind: 'update_person' }>
): RowOp[] {
	const person = requirePerson(rows, command.personId);
	checkPersonVersion(rows, person, command.expectedVersion);

	const after: IndividualRow = {
		...person,
		givenName: command.givenName !== undefined ? cleanText(command.givenName) : person.givenName,
		surname: command.surname !== undefined ? cleanText(command.surname) : person.surname,
		sex: command.sex !== undefined ? command.sex : person.sex
	};
	const eventOps = [
		...upsertEvent(rows, ctx, 'INDIVIDUAL', person.id, 'BIRT', {
			dateText: command.birthDate,
			place: command.birthPlace
		}),
		...upsertEvent(rows, ctx, 'INDIVIDUAL', person.id, 'DEAT', {
			dateText: command.deathDate,
			place: command.deathPlace
		})
	];
	const isPersonChanged =
		after.givenName !== person.givenName ||
		after.surname !== person.surname ||
		after.sex !== person.sex;
	if (!isPersonChanged && eventOps.length === 0) return [];
	// The form's name fields are the preferred name row's; editing one edits the other (ADR-013).
	const nameOps = preferredNameOps(rows, ctx, person.id, {
		givenName: after.givenName,
		surname: after.surname
	});
	return [
		{ table: 'individuals', id: person.id, before: person, after: touch(after, ctx) },
		...nameOps,
		...eventOps
	];
}

function setPersonPrivacy(
	rows: TreeRows,
	ctx: OpContext,
	command: Extract<RelationshipCommand, { kind: 'set_person_privacy' }>
): RowOp[] {
	const person = requirePerson(rows, command.personId);
	checkPersonVersion(rows, person, command.expectedVersion);
	if (person.privacy === command.privacy) return [];
	return [
		{
			table: 'individuals',
			id: person.id,
			before: person,
			after: touch({ ...person, privacy: command.privacy }, ctx)
		}
	];
}

function recordDeath(
	rows: TreeRows,
	ctx: OpContext,
	command: Extract<RelationshipCommand, { kind: 'record_death' }>
): RowOp[] {
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

function deletePerson(
	rows: TreeRows,
	ctx: OpContext,
	command: Extract<RelationshipCommand, { kind: 'delete_person' }>
): RowOp[] {
	const person = requirePerson(rows, command.personId);
	checkPersonVersion(rows, person, command.expectedVersion);
	const ops: RowOp[] = [];
	const remove = <T extends RecordTable>(table: T, row: TableRows[T]) =>
		ops.push(rowOp(table, row.id, row, null));

	rows.personNames
		.filter((n) => n.personId === person.id)
		.forEach((n) => remove('person_names', n));
	rows.parentChild
		.filter((l) => l.parentId === person.id || l.childId === person.id)
		.forEach((l) => remove('parent_child', l));
	eventsOf(rows, 'INDIVIDUAL', person.id).forEach((e) => remove('events', e));
	ops.push(...detachFilesOf(rows, ctx, new Set([person.id])));

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
			ops.push(...detachFilesOf(rows, ctx, new Set([union.id])));
			for (const link of rows.parentChild.filter(
				(l) => l.unionId === union.id && l.parentId !== person.id && l.childId !== person.id
			)) {
				ops.push({
					table: 'parent_child',
					id: link.id,
					before: link,
					after: touch({ ...link, unionId: null }, ctx)
				});
			}
			remove('unions', union);
		}
	}
	remove('individuals', person);
	return ops;
}
