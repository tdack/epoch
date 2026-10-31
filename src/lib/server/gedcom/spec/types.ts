/**
 * Shapes of the generated GEDCOM 7 spec table. Hand-written so the generator output can be
 * checked against them with `satisfies` instead of defining its own types.
 */

/** `max: null` is the spec's `M` (unbounded). */
interface Cardinality {
	min: 0 | 1;
	max: 1 | null;
}

export interface SubstructureSpec extends Cardinality {
	/** The structure type that applies to this tag in this parent. */
	uri: string;
}

/**
 * What a structure line may carry after its tag. Pointers always also accept `@VOID@`, which
 * the spec states in prose rather than in the table.
 */
type PayloadSpec =
	| { kind: 'none' }
	| { kind: 'string' }
	| { kind: 'integer' }
	| { kind: 'uri' }
	| { kind: 'language' }
	| { kind: 'mediaType' }
	/** Literally `Y`, or no payload. */
	| { kind: 'yOrNull' }
	| { kind: 'pointer'; target: string }
	| { kind: 'dateValue' }
	| { kind: 'dateExact' }
	| { kind: 'datePeriod' }
	| { kind: 'age' }
	| { kind: 'enum'; enumSet: string }
	/** A comma-separated list whose items come from `enumSet`. */
	| { kind: 'listEnum'; enumSet: string }
	| { kind: 'listText' }
	| { kind: 'filePath' }
	| { kind: 'latitude' }
	| { kind: 'longitude' }
	| { kind: 'name' }
	| { kind: 'tagDef' }
	| { kind: 'time' };

export interface StructureSpec {
	/** The standard tag as written in a file. Several structure types share one tag. */
	tag: string;
	payload: PayloadSpec;
	/** Keyed by tag. */
	subs: Readonly<Record<string, SubstructureSpec>>;
}

export interface RootRecordSpec extends Cardinality {
	/** The structure type, a key of the structure table. */
	uri: string;
}

export interface CalendarSpec {
	uri: string;
	/** Month tags in calendar order. */
	months: readonly string[];
}
