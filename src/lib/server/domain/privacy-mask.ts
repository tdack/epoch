/**
 * Masks a set of tree rows for a viewer who may not see private people (ADR-015). Pure, and over
 * `TreeRows`, so every reader that works on loaded rows (the focus window, the record pages) shares
 * one rule; the paged reads that cannot load rows use the SQL form in `repositories/visibility.ts`.
 *
 * Two modes, set per tree:
 * - **omit:** a private person, their names and facts, and every link and partner row that names
 *   them are gone, as if they were never recorded. Counts, stubs and relationships are computed over
 *   what is left, so nothing says someone was removed.
 * - **placeholder:** structure stays, so a relationship can be drawn, but a private person has no
 *   name, sex, XREF, names or facts: they are "Private".
 * In both, a partnership with a private partner loses its own facts: a marriage date and place are
 * facts about the people in it.
 */

import { isPersonPrivate, type LivingFact } from './living-state';
import type { IndividualRow, TreeRows } from './change-log';

export const PRIVATE_PLACEHOLDER_NAME = 'Private';

export interface MaskedRows {
	rows: TreeRows;
	/** The people that remain as placeholders; empty in omit mode, where none remain. */
	placeholderIds: Set<string>;
}

/** Everyone in these rows who is private, from their override and the facts the rows hold for them. */
export function privatePeople(rows: TreeRows, cutoff: string): Set<string> {
	const factsOf = new Map<string, LivingFact[]>();
	for (const e of rows.events) {
		if (e.entityType !== 'INDIVIDUAL') continue;
		const facts = factsOf.get(e.entityId) ?? [];
		facts.push({ type: e.type, dateSortEnd: e.dateSortEnd });
		factsOf.set(e.entityId, facts);
	}
	return new Set(rows.individuals.filter((i) => isPersonPrivate(i.privacy, factsOf.get(i.id) ?? [], cutoff)).map((i) => i.id));
}

const placeholderOf = (row: IndividualRow): IndividualRow => ({ ...row, xrefId: null, givenName: PRIVATE_PLACEHOLDER_NAME, surname: null, sex: 'U' });

export function maskRows(rows: TreeRows, cutoff: string, shouldShowStructure: boolean): MaskedRows {
	const hidden = privatePeople(rows, cutoff);
	if (hidden.size === 0) return { rows, placeholderIds: new Set() };

	const unionsWithHiddenPartner = new Set(rows.unionPartners.filter((p) => hidden.has(p.personId)).map((p) => p.unionId));
	const events = rows.events.filter((e) => (e.entityType === 'INDIVIDUAL' ? !hidden.has(e.entityId) : !unionsWithHiddenPartner.has(e.entityId)));
	const personNames = rows.personNames.filter((n) => !hidden.has(n.personId));
	// Media of a private person is theirs; the window never carries media, but a reader that does must not show it.
	const mediaItems = rows.mediaItems.filter((m) => !hidden.has(m.entityId));

	if (shouldShowStructure) {
		return {
			rows: { ...rows, individuals: rows.individuals.map((i) => (hidden.has(i.id) ? placeholderOf(i) : i)), personNames, events, mediaItems },
			placeholderIds: hidden
		};
	}

	const unionPartners = rows.unionPartners.filter((p) => !hidden.has(p.personId));
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
