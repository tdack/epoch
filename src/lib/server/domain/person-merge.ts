/**
 * Row operations for merging two records of one person (ADR-022): the merged-away record's names,
 * facts, relationships and media move to the survivor, and the record itself is deleted, in one
 * change and so one undo.
 *
 * What is never decided for the user: facts are repeatable, so two different births are both kept
 * and only a fact stated identically twice collapses to one. The only fields that cannot hold both
 * values (a sex that differs) must be chosen, as a partnership merge makes the user choose.
 * Parentage is a fact about parent and child, so every link is kept and only re-pointed; a link the
 * survivor already has is the same assertion and is dropped.
 *
 * Order matters to the store (creates, then updates, then deletes), and it suits this: every row
 * that points at the merged person is re-pointed or deleted by an update or delete listed before
 * the person's own delete, so no foreign key cascade ever removes a row outside the log.
 */

import type {
	EventRow,
	IndividualRow,
	ParentChildRow,
	PersonNameRow,
	RowOp,
	TreeRows,
	UnionPartnerRow
} from './change-log';
import {
	ConcurrencyConflictError,
	NotFoundError,
	PersonMergeConflictError,
	ValidationError
} from './errors';
import { factTypeInfo } from '../../shared/fact-types';
import { CITATION_SUBJECT_KINDS } from '../../shared/evidence';
import { makeEvidenceMover } from './evidence-ops';
import {
	MAX_PERSON_MERGE_OPS,
	PERSON_MERGE_REFUSALS,
	type PersonMergeChoices,
	type PersonMergeConflict
} from '../../shared/person-merge';

export type PersonMergeCommand = {
	kind: 'merge_people';
	/** The record that remains: its id, XREF, preferred name and favourites stay. */
	survivorId: string;
	/** The record folded into it and deleted. */
	mergedId: string;
	/** Version each person was loaded at, keyed by person id. */
	expectedVersions?: Record<string, number>;
	keep?: PersonMergeChoices;
};

export interface PersonMergeContext {
	treeId: string;
	/** Epoch milliseconds, stamped on every row written. */
	now: number;
	newId: () => string;
}

const touch = <T extends { version: number; updatedAt: number | null }>(
	row: T,
	ctx: PersonMergeContext
): T => ({
	...row,
	version: row.version + 1,
	updatedAt: ctx.now
});

function requirePerson(rows: TreeRows, id: string): IndividualRow {
	const person = rows.individuals.find((p) => p.id === id);
	if (!person) throw new NotFoundError('Person', id);
	return person;
}

/** Every person reachable from this one by following parent links upwards. */
function ancestorsOf(rows: TreeRows, personId: string): Set<string> {
	const parentsOf = new Map<string, string[]>();
	for (const link of rows.parentChild)
		parentsOf.set(link.childId, [...(parentsOf.get(link.childId) ?? []), link.parentId]);
	const seen = new Set<string>();
	const queue = [personId];
	while (queue.length > 0) {
		for (const parent of parentsOf.get(queue.shift()!) ?? []) {
			if (seen.has(parent)) continue;
			seen.add(parent);
			queue.push(parent);
		}
	}
	return seen;
}

/** Why these two cannot be one person, or null. Siblings can: the commonest duplicate is one child entered twice. */
export function personMergeRefusal(
	rows: TreeRows,
	survivorId: string,
	mergedId: string
): string | null {
	if (survivorId === mergedId) return PERSON_MERGE_REFUSALS.SAME_PERSON;
	if (ancestorsOf(rows, survivorId).has(mergedId) || ancestorsOf(rows, mergedId).has(survivorId))
		return PERSON_MERGE_REFUSALS.ANCESTOR;
	const unionsOfSurvivor = new Set(
		rows.unionPartners.filter((p) => p.personId === survivorId).map((p) => p.unionId)
	);
	if (rows.unionPartners.some((p) => p.personId === mergedId && unionsOfSurvivor.has(p.unionId)))
		return PERSON_MERGE_REFUSALS.SAME_PARTNERSHIP;
	return null;
}

export function personMergeConflicts(
	rows: TreeRows,
	survivorId: string,
	mergedId: string
): PersonMergeConflict[] {
	const survivor = requirePerson(rows, survivorId);
	const merged = requirePerson(rows, mergedId);
	const [a, b] = [survivor.sex ?? 'U', merged.sex ?? 'U'];
	return a !== 'U' && b !== 'U' && a !== b ? [{ kind: 'sex', survivor: a, merged: b }] : [];
}

/** The text a fact states, so a fact written identically on both records is kept once. */
const factKey = (e: EventRow) =>
	JSON.stringify([e.type, e.dateRaw, e.place, e.description, e.value, e.cause, e.age, e.notes]);

/** What a name says, so a name both records have is kept once. */
const nameKey = (n: PersonNameRow) =>
	JSON.stringify([
		n.type,
		n.givenName,
		n.surname,
		n.namePrefix,
		n.nameSuffix,
		n.nickname,
		n.surnamePrefix,
		n.gedcomType,
		n.dateRaw,
		n.unionId
	]);

const sameWords = (a: string | null, b: string | null) =>
	(a ?? '').trim().toLowerCase() === (b ?? '').trim().toLowerCase();

export function buildPersonMergeOps(
	rows: TreeRows,
	command: PersonMergeCommand,
	ctx: PersonMergeContext
): RowOp[] {
	const survivor = requirePerson(rows, command.survivorId);
	const merged = requirePerson(rows, command.mergedId);
	for (const person of [survivor, merged]) {
		const expected = command.expectedVersions?.[person.id];
		if (expected !== undefined && person.version !== expected) {
			throw new ConcurrencyConflictError(
				`${person.givenName ?? 'This person'} was changed by someone else (you had version ${expected}, it is now ${person.version}).`,
				{
					reason: 'STALE_VERSION',
					entity: 'individual',
					id: person.id,
					expectedVersion: expected,
					currentVersion: person.version
				}
			);
		}
	}
	const refusal = personMergeRefusal(rows, survivor.id, merged.id);
	if (refusal) throw new ValidationError(refusal);

	const conflicts = personMergeConflicts(rows, survivor.id, merged.id);
	if (conflicts.length > 0 && !command.keep?.sex) {
		throw new PersonMergeConflictError(
			'They have a different sex recorded; choose which to keep.',
			conflicts
		);
	}
	const sex =
		conflicts.length > 0
			? command.keep!.sex === 'merged'
				? merged.sex
				: survivor.sex
			: survivor.sex === 'U' || survivor.sex === null
				? merged.sex
				: survivor.sex;
	// A merge can only make someone more private: a manager's "private" on either record is kept.
	const privacy = merged.privacy === 'private' ? 'private' : survivor.privacy;

	const ops: RowOp[] = [];
	// Evidence is never dropped: a record that is folded into another (or written anew) hands its
	// citations to the one that now says the same thing.
	const citations = makeEvidenceMover(rows, ctx);
	const cited = CITATION_SUBJECT_KINDS;

	// ---- Names ----
	const survivorNames = rows.personNames.filter((n) => n.personId === survivor.id);
	const known = new Map(survivorNames.map((n) => [nameKey(n), n.id] as const));
	let nextOrder = Math.max(-1, ...survivorNames.map((n) => n.order)) + 1;
	const mergedNames = rows.personNames
		.filter((n) => n.personId === merged.id)
		.sort((a, b) => a.order - b.order);
	for (const name of mergedNames) {
		if (known.has(nameKey(name))) {
			ops.push({ table: 'person_names', id: name.id, before: name, after: null });
			ops.push(
				...citations.move(
					{ kind: cited.NAME, id: name.id },
					{ kind: cited.NAME, id: known.get(nameKey(name))! }
				)
			);
			continue;
		}
		known.set(nameKey(name), name.id);
		// The survivor's preferred name stays the one the person is shown by.
		ops.push({
			table: 'person_names',
			id: name.id,
			before: name,
			after: touch({ ...name, personId: survivor.id, isPreferred: false, order: nextOrder++ }, ctx)
		});
	}
	// A record made in the editor can carry its name only on the person row; keep it as a name too.
	const isNameCovered = [...survivorNames, ...mergedNames].some(
		(n) => sameWords(n.givenName, merged.givenName) && sameWords(n.surname, merged.surname)
	);
	const isSurvivorOwnName =
		sameWords(survivor.givenName, merged.givenName) && sameWords(survivor.surname, merged.surname);
	if ((merged.givenName || merged.surname) && !isNameCovered && !isSurvivorOwnName) {
		const row: PersonNameRow = {
			id: ctx.newId(),
			personId: survivor.id,
			type: 'aka',
			givenName: merged.givenName,
			surname: merged.surname,
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
			order: nextOrder,
			version: 1,
			createdAt: ctx.now,
			updatedAt: ctx.now
		};
		ops.push({ table: 'person_names', id: row.id, before: null, after: row });
	}

	// ---- Facts ----
	const survivorFacts = rows.events.filter(
		(e) => e.entityType === 'INDIVIDUAL' && e.entityId === survivor.id
	);
	const stated = new Map(survivorFacts.map((e) => [factKey(e), e.id] as const));
	for (const fact of rows.events.filter(
		(e) => e.entityType === 'INDIVIDUAL' && e.entityId === merged.id
	)) {
		if (stated.has(factKey(fact))) {
			ops.push({ table: 'events', id: fact.id, before: fact, after: null });
			ops.push(
				...citations.move(
					{ kind: cited.EVENT, id: fact.id },
					{ kind: cited.EVENT, id: stated.get(factKey(fact))! }
				)
			);
			continue;
		}
		stated.set(factKey(fact), fact.id);
		if (factTypeInfo(fact.type)?.isSingular) {
			// The first birth or death on file is the one cards and the person form use, and "first" is
			// the order rows were written. Written anew, a moved birth lands behind the survivor's own.
			ops.push({ table: 'events', id: fact.id, before: fact, after: null });
			const moved: EventRow = {
				...fact,
				id: ctx.newId(),
				entityId: survivor.id,
				version: 1,
				createdAt: ctx.now,
				updatedAt: ctx.now
			};
			ops.push({ table: 'events', id: moved.id, before: null, after: moved });
			ops.push(
				...citations.move({ kind: cited.EVENT, id: fact.id }, { kind: cited.EVENT, id: moved.id })
			);
		} else {
			ops.push({
				table: 'events',
				id: fact.id,
				before: fact,
				after: touch({ ...fact, entityId: survivor.id }, ctx)
			});
		}
	}

	// ---- Parents and children ----
	const links = rows.parentChild;
	const movedLinks = new Map<string, string>();
	for (const link of links.filter((l) => l.parentId === merged.id || l.childId === merged.id)) {
		const next: ParentChildRow = {
			...link,
			parentId: link.parentId === merged.id ? survivor.id : link.parentId,
			childId: link.childId === merged.id ? survivor.id : link.childId
		};
		const key = `${next.parentId}>${next.childId}>${next.type}`;
		// The survivor already asserts this, or an earlier moved link does: one assertion is enough.
		const sameLink =
			movedLinks.get(key) ??
			links.find(
				(l) => l.parentId === next.parentId && l.childId === next.childId && l.type === next.type
			)?.id;
		if (sameLink) {
			ops.push({ table: 'parent_child', id: link.id, before: link, after: null });
			ops.push(
				...citations.move(
					{ kind: cited.PARENT_CHILD, id: link.id },
					{ kind: cited.PARENT_CHILD, id: sameLink }
				)
			);
			continue;
		}
		movedLinks.set(key, link.id);
		ops.push({ table: 'parent_child', id: link.id, before: link, after: touch(next, ctx) });
	}

	// ---- Partnerships ----
	const touchedUnions = new Set<string>();
	for (const membership of rows.unionPartners.filter((p) => p.personId === merged.id)) {
		const next: UnionPartnerRow = { ...membership, personId: survivor.id };
		ops.push({ table: 'union_partners', id: membership.id, before: membership, after: next });
		touchedUnions.add(membership.unionId);
	}
	for (const unionId of touchedUnions) {
		const union = rows.unions.find((u) => u.id === unionId);
		// Its partners changed, so a stale partnership editor must conflict (as deleting a person does).
		if (union) ops.push({ table: 'unions', id: union.id, before: union, after: touch(union, ctx) });
	}

	// ---- Evidence about the person themself ----
	ops.push(
		...citations.move(
			{ kind: cited.PERSON, id: merged.id },
			{ kind: cited.PERSON, id: survivor.id }
		)
	);

	// ---- Media ----
	for (const item of rows.mediaItems.filter((m) => m.entityId === merged.id)) {
		ops.push({
			table: 'media_items',
			id: item.id,
			before: item,
			after: { ...item, entityId: survivor.id }
		});
	}

	// ---- The two person rows ----
	const aliases = [...(survivor.xrefAliases ?? [])];
	for (const alias of [merged.xrefId, ...(merged.xrefAliases ?? [])]) {
		if (alias && alias !== survivor.xrefId && !aliases.includes(alias)) aliases.push(alias);
	}
	ops.push({ table: 'individuals', id: merged.id, before: merged, after: null });
	ops.push({
		table: 'individuals',
		id: survivor.id,
		before: survivor,
		after: touch(
			{ ...survivor, sex, privacy, xrefAliases: aliases.length > 0 ? aliases : null },
			ctx
		)
	});

	if (ops.length > MAX_PERSON_MERGE_OPS) {
		throw new ValidationError(
			`This merge would change ${ops.length} records; one merge works on at most ${MAX_PERSON_MERGE_OPS}.`
		);
	}
	return ops;
}
