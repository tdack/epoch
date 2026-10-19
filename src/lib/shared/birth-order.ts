/**
 * The order children are shown in: oldest first, youngest last. One comparator for the person
 * page, the drawer, the partnership page and the charts, so they cannot disagree.
 *
 * The key is a plain `YYYY-MM-DD` the server derives from the stored date bounds (never from text
 * in the browser). It is the lower bound of the date, so `1900` sorts before `15 MAR 1900` and
 * `ABT 1900` beside `1900`; an upper bound is used only when there is no lower one (`BEF 1900`).
 */

export interface BirthOrderable {
	/** Sort key of the birth (else baptism); null when nobody may see it or none is recorded. */
	birthSort: string | null;
	/** An explicit position among siblings, when the record has one; the first tie-break. */
	order?: number;
	/** Display name, the second tie-break. */
	name: string;
}

/** A stored date's bounds, as `DateValue` and the event rows carry them. */
interface DateBounds {
	sortStart: string | null;
	sortEnd: string | null;
}

/** The key of one date: its lower bound, else its upper bound, else none. */
export function sortKeyOf(date: DateBounds): string | null {
	return date.sortStart ?? date.sortEnd ?? null;
}

/**
 * The key of a person's birth: the first dated birth, else the first dated baptism or christening.
 * `births` and `baptisms` are the person's own events in their stored order.
 */
export function birthSortOf(
	births: readonly DateBounds[],
	baptisms: readonly DateBounds[]
): string | null {
	for (const date of [...births, ...baptisms]) {
		const key = sortKeyOf(date);
		if (key) return key;
	}
	return null;
}

/**
 * Oldest first. A child with no key goes after every dated one and keeps its place among the
 * undated. Equal keys fall back to an explicit `order` when both have one, then to the name, then
 * to the position they came in (`parent_child` records no sibling order of its own).
 */
export function sortByBirth<T>(items: readonly T[], of: (item: T) => BirthOrderable): T[] {
	return items
		.map((item, index) => ({ item, index, key: of(item) }))
		.sort((a, b) => {
			const [ka, kb] = [a.key.birthSort, b.key.birthSort];
			if (ka !== kb) {
				if (ka === null) return 1;
				if (kb === null) return -1;
				return ka < kb ? -1 : 1;
			}
			if (ka === null) return a.index - b.index;
			const [oa, ob] = [a.key.order, b.key.order];
			return (
				(oa !== undefined && ob !== undefined ? oa - ob : 0) ||
				a.key.name.localeCompare(b.key.name) ||
				a.index - b.index
			);
		})
		.map((entry) => entry.item);
}
