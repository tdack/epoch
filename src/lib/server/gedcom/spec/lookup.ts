import {
	GEDCOM7_CALENDARS,
	GEDCOM7_ENUM_SETS,
	GEDCOM7_ROOTS,
	GEDCOM7_STRUCTURES
} from './gedcom7-spec';
import type { CalendarSpec, RootRecordSpec, StructureSpec, SubstructureSpec } from './types';

// The `as const` table is far more specific than the lookups need; widening once here keeps the
// helpers simple while callers who hold a literal URI still get the narrow type from the table.
const structures: Readonly<Record<string, StructureSpec>> = GEDCOM7_STRUCTURES;
const enumSets: Readonly<Record<string, readonly string[]>> = GEDCOM7_ENUM_SETS;
const roots: Readonly<Record<string, RootRecordSpec>> = GEDCOM7_ROOTS;
const calendars: Readonly<Record<string, CalendarSpec>> = GEDCOM7_CALENDARS;

/** Own-property lookup, so a tag such as `constructor` cannot reach the prototype. */
function own<T>(table: Readonly<Record<string, T>>, key: string): T | undefined {
	return Object.hasOwn(table, key) ? table[key] : undefined;
}

export function structureByUri(uri: string): StructureSpec | undefined {
	return own(structures, uri);
}

/**
 * The structure type that `tag` denotes beneath `parentUri`, with its cardinality there, or
 * undefined when the spec does not allow that tag in that context. Extension tags (leading
 * underscore) are never in the table; callers decide how to treat them.
 */
export function substructureOf(parentUri: string, tag: string): SubstructureSpec | undefined {
	const parent = own(structures, parentUri);
	return parent ? own(parent.subs, tag) : undefined;
}

/** The level-0 structure for `tag`: `HEAD`, `TRLR` or one of the seven record types. */
export function rootOf(tag: string): RootRecordSpec | undefined {
	return own(roots, tag);
}

/** The allowed value tags of an enumeration set, or undefined for an unknown set. */
export function enumValues(setUri: string): readonly string[] | undefined {
	return own(enumSets, setUri);
}

export function isEnumValue(setUri: string, value: string): boolean {
	return enumValues(setUri)?.includes(value) ?? false;
}

/** Calendar by tag (`GREGORIAN`, `JULIAN`, `HEBREW`, `FRENCH_R`), with its month tags. */
export function calendarOf(tag: string): CalendarSpec | undefined {
	return own(calendars, tag);
}
