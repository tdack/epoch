/**
 * Places as the lists and the place page see them (Phase 1 `place_ref`, Phase 3 item 4).
 *
 * A place is the text a fact carries, grouped without regard to case (ASCII, as SQLite's `nocase`
 * is). There is no stored reference: the text on each fact stays the single authority, so export is
 * byte-identical and no writer, import or undo has a link to keep in step (ADR-018). The text is
 * the key; the address of a place page is that text.
 */

export const MAX_PLACE_SUGGESTIONS = 10;

export interface PlaceListItem {
	/** The text as first written (in index order) among the facts that group here. */
	name: string;
	/** Facts the viewer may see that carry this place. */
	facts: number;
	/** Distinct people with such a fact; a partnership's fact counts as a fact and not as a person. */
	people: number;
}

export interface PlaceFactDto {
	id: string;
	/** The fact type's label, e.g. "Birth". */
	label: string;
	dateText: string | null;
	kind: 'person' | 'partnership';
	/** The person, or the partnership, the fact belongs to. */
	entityId: string;
	entityName: string;
}

export interface PlaceDto {
	name: string;
	facts: PlaceFactDto[];
	hasMore: boolean;
	offset: number;
	limit: number;
}

/** The text of a place as stored: only the surrounding spaces are insignificant. */
export function placeText(value: string): string {
	return value.replace(/^ +| +$/g, '');
}
