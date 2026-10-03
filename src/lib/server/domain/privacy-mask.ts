/**
 * Masks a set of tree rows for a viewer who may not see private people (ADR-015). Pure, and over
 * `TreeRows`, so every reader that works on loaded rows (the focus window, the record pages) shares
 * one rule; the paged reads that cannot load rows use the SQL form in `repositories/visibility.ts`.
 *
 * Two modes, set per tree:
 * - **omit:** a private person, their names and facts, every link and partner row that names them,
 *   and every partnership they are in are gone, as if they were never recorded. Counts, stubs and relationships are computed over
 *   what is left, so nothing says someone was removed.
 * - **placeholder:** structure stays, so a relationship can be drawn, but a private person has no
 *   name, sex, XREF, names or facts: they are "Private".
 * In both, a partnership with a private partner loses its own facts: a marriage date and place are
 * facts about the people in it.
 */

import { isPersonPrivate, type LivingFact } from './living-state';
import type { IndividualRow, RowOp, TreeRows } from './change-log';
import { NotFoundError } from './errors';

export const PRIVATE_PLACEHOLDER_NAME = 'Private';

export interface MaskedRows {
	rows: TreeRows;
	/** The people that remain as placeholders; empty in omit mode, where none remain. */
	placeholderIds: Set<string>;
}

/** Everyone in these rows who is private, from their override and the facts the rows hold for them. */
export function privatePeople(
	rows: TreeRows,
	cutoff: string,
	creatorId: string | null = null
): Set<string> {
	const factsOf = new Map<string, LivingFact[]>();
	for (const e of rows.events) {
		if (e.entityType !== 'INDIVIDUAL') continue;
		const facts = factsOf.get(e.entityId) ?? [];
		facts.push({ type: e.type, dateSortEnd: e.dateSortEnd });
		factsOf.set(e.entityId, facts);
	}
	return new Set(
		rows.individuals
			.filter((i) =>
				isPersonPrivate(
					i.privacy,
					factsOf.get(i.id) ?? [],
					cutoff,
					creatorId !== null && i.createdBy === creatorId
				)
			)
			.map((i) => i.id)
	);
}

const placeholderOf = (row: IndividualRow): IndividualRow => ({
	...row,
	xrefId: null,
	givenName: PRIVATE_PLACEHOLDER_NAME,
	surname: null,
	sex: 'U'
});

export function maskRows(
	rows: TreeRows,
	cutoff: string,
	shouldShowStructure: boolean,
	creatorId: string | null = null
): MaskedRows {
	const hidden = privatePeople(rows, cutoff, creatorId);
	if (hidden.size === 0) return { rows, placeholderIds: new Set() };

	const unionsWithHiddenPartner = new Set(
		rows.unionPartners.filter((p) => hidden.has(p.personId)).map((p) => p.unionId)
	);
	const events = rows.events.filter((e) =>
		e.entityType === 'INDIVIDUAL'
			? !hidden.has(e.entityId)
			: !unionsWithHiddenPartner.has(e.entityId)
	);
	const personNames = rows.personNames.filter((n) => !hidden.has(n.personId));
	// Media of a private person is theirs; the window never carries media, but a reader that does must not show it.
	const mediaItems = rows.mediaItems.filter((m) => !hidden.has(m.entityId));

	if (shouldShowStructure) {
		return {
			rows: {
				...rows,
				individuals: rows.individuals.map((i) => (hidden.has(i.id) ? placeholderOf(i) : i)),
				personNames,
				events,
				mediaItems
			},
			placeholderIds: hidden
		};
	}

	// A partnership with a private partner is not left standing with the partner who remains: its page,
	// its facts and the list all treat it as absent, so a link to it from a page would be a dead end
	// that also says something is there. Its children keep their parent and lose the partnership.
	const unionPartners = rows.unionPartners.filter(
		(p) => !hidden.has(p.personId) && !unionsWithHiddenPartner.has(p.unionId)
	);
	const keptUnions = new Set(unionPartners.map((p) => p.unionId));
	return {
		rows: {
			individuals: rows.individuals.filter((i) => !hidden.has(i.id)),
			personNames,
			unions: rows.unions.filter((u) => keptUnions.has(u.id)),
			unionPartners,
			parentChild: rows.parentChild
				.filter((l) => !hidden.has(l.parentId) && !hidden.has(l.childId))
				.map((l) => (l.unionId && !keptUnions.has(l.unionId) ? { ...l, unionId: null } : l)),
			events: events.filter((e) => e.entityType === 'INDIVIDUAL' || keptUnions.has(e.entityId)),
			mediaItems
		},
		placeholderIds: new Set()
	};
}

/** The part of a viewer's scope that decides what they see of private people; a `ViewerScope` has it. */
export interface MaskScope {
	isRestricted: boolean;
	cutoff: string;
	creatorId: string | null;
	shouldShowPrivateStructure: boolean;
}

/** The rows as this viewer may see them: untouched for roles that see everyone, else masked as the tree is set to. */
export function maskForScope(rows: TreeRows, scope: MaskScope): MaskedRows {
	return scope.isRestricted
		? maskRows(rows, scope.cutoff, scope.shouldShowPrivateStructure, scope.creatorId)
		: { rows, placeholderIds: new Set() };
}

/**
 * The rows with private people omitted, never shown as placeholders. For readers whose output
 * could be written back (a planner) or that have no use for a placeholder (the quality report).
 */
export function omitForScope(rows: TreeRows, scope: MaskScope): TreeRows {
	return scope.isRestricted ? maskRows(rows, scope.cutoff, false, scope.creatorId).rows : rows;
}

/**
 * Masks a loaded window for the viewer, first checking that every subject was found and is theirs
 * to see. A private subject answers as a missing one does, so asking for a person never says they
 * exist (ADR-015).
 */
export function requireVisibleSubject(
	window: { rows: TreeRows; foundStartIds: readonly string[] },
	personIds: string | readonly string[],
	scope: MaskScope
): MaskedRows {
	const hidden = scope.isRestricted
		? privatePeople(window.rows, scope.cutoff, scope.creatorId)
		: new Set<string>();
	for (const id of typeof personIds === 'string' ? [personIds] : personIds)
		if (!window.foundStartIds.includes(id) || hidden.has(id)) throw new NotFoundError('Person', id);
	return maskForScope(window.rows, scope);
}

/**
 * Whether any of these row operations reads or writes a record that belongs to a private person:
 * the person, their names, facts, links, partner rows and media, or a partnership they are in.
 * A restricted viewer's mutation is refused if it does (ADR-015), because the result would carry
 * or change something they may not see.
 */
export function opsTouchPrivate(
	ops: readonly RowOp[],
	rows: TreeRows,
	cutoff: string,
	creatorId: string | null = null
): boolean {
	const hidden = privatePeople(rows, cutoff, creatorId);
	if (hidden.size === 0) return false;
	const hiddenUnions = new Set(
		rows.unionPartners.filter((p) => hidden.has(p.personId)).map((p) => p.unionId)
	);
	return ops.some((op) => touchesHidden(op, hidden, hiddenUnions));
}

function touchesHidden(op: RowOp, hidden: Set<string>, hiddenUnions: Set<string>): boolean {
	return [op.before, op.after].some((image) => {
		if (!image) return false;
		const r = image as Record<string, string | undefined>;
		switch (op.table) {
			case 'individuals':
				return hidden.has(op.id);
			case 'person_names':
				return hidden.has(r.personId ?? '');
			case 'unions':
				return hiddenUnions.has(op.id);
			case 'union_partners':
				return hidden.has(r.personId ?? '') || hiddenUnions.has(r.unionId ?? '');
			case 'parent_child':
				return (
					hidden.has(r.parentId ?? '') ||
					hidden.has(r.childId ?? '') ||
					hiddenUnions.has(r.unionId ?? '')
				);
			case 'events':
				return r.entityType === 'INDIVIDUAL'
					? hidden.has(r.entityId ?? '')
					: hiddenUnions.has(r.entityId ?? '');
			case 'media_items':
				return hidden.has(r.entityId ?? '');
			default:
				return false;
		}
	});
}
