/**
 * The person page's map of a life: dated facts at located places, numbered in date order and
 * joined by a line (ADR-078). Pure, so the order and the grouping are tested without a map.
 */

const LIFE_GROUPS = {
	BIRTH: 'birth',
	PARTNERSHIP: 'partnership',
	RESIDENCE: 'residence',
	DEATH: 'death',
	OTHER: 'other'
} as const;
export type LifeGroup = (typeof LIFE_GROUPS)[keyof typeof LIFE_GROUPS];

const GROUP_OF_TYPE: Readonly<Record<string, LifeGroup>> = {
	BIRT: LIFE_GROUPS.BIRTH,
	CHR: LIFE_GROUPS.BIRTH,
	BAPM: LIFE_GROUPS.BIRTH,
	MARR: LIFE_GROUPS.PARTNERSHIP,
	MARB: LIFE_GROUPS.PARTNERSHIP,
	MARC: LIFE_GROUPS.PARTNERSHIP,
	MARL: LIFE_GROUPS.PARTNERSHIP,
	MARS: LIFE_GROUPS.PARTNERSHIP,
	ENGA: LIFE_GROUPS.PARTNERSHIP,
	DIV: LIFE_GROUPS.PARTNERSHIP,
	DIVF: LIFE_GROUPS.PARTNERSHIP,
	ANUL: LIFE_GROUPS.PARTNERSHIP,
	RESI: LIFE_GROUPS.RESIDENCE,
	CENS: LIFE_GROUPS.RESIDENCE,
	DEAT: LIFE_GROUPS.DEATH,
	BURI: LIFE_GROUPS.DEATH,
	CREM: LIFE_GROUPS.DEATH
};

export function lifeGroupOf(type: string): LifeGroup {
	return GROUP_OF_TYPE[type] ?? LIFE_GROUPS.OTHER;
}

/** Where a fact sits, in degrees. */
export interface FactLocation {
	latitude: number;
	longitude: number;
}

/** The part of a fact the map needs. */
export interface LifeFact {
	id: string;
	type: string;
	label: string;
	dateText: string | null;
	/** The page's date sort key; null when the fact is undated. */
	sortStart: string | null;
	place: string | null;
}

/** One marker: consecutive facts at the same spot share it. */
export interface LifeStop extends FactLocation {
	group: LifeGroup;
	/** Empty for an undated stop. */
	numbers: number[];
	lines: string[];
}

interface LifeItem {
	/** Null for an undated fact. */
	n: number | null;
	text: string;
}

export interface LifeMapData {
	stops: LifeStop[];
	/** The dated stops in order, to be joined by a line. */
	path: Array<[number, number]>;
	/** Every located fact as the text equivalent of the map: dated in order, then undated. */
	items: LifeItem[];
}

const sameSpot = (a: FactLocation, b: FactLocation) =>
	a.latitude === b.latitude && a.longitude === b.longitude;

function describe(f: LifeFact): string {
	return [f.label, f.dateText, f.place].filter(Boolean).join(', ');
}

/**
 * `locations` maps a fact id to its place's confirmed location; a fact without one is left off.
 * Dated facts are those with a sort key, ordered by it with the given order breaking ties.
 */
export function lifeMap(
	facts: readonly LifeFact[],
	locations: Readonly<Record<string, FactLocation>>
): LifeMapData {
	const located = facts.filter((f) => locations[f.id]);
	const dated = located
		.filter((f) => f.sortStart !== null)
		.sort((a, b) => (a.sortStart! < b.sortStart! ? -1 : a.sortStart! > b.sortStart! ? 1 : 0));
	const undated = located.filter((f) => f.sortStart === null);

	const stops: LifeStop[] = [];
	const items: LifeItem[] = [];
	dated.forEach((f, i) => {
		const at = locations[f.id]!;
		const last = stops.at(-1);
		const n = i + 1;
		const line = `${n}. ${describe(f)}`;
		if (last && last.numbers.length > 0 && sameSpot(last, at)) {
			last.numbers.push(n);
			last.lines.push(line);
		} else stops.push({ ...at, group: lifeGroupOf(f.type), numbers: [n], lines: [line] });
		items.push({ n, text: describe(f) });
	});
	const path = stops.map((s): [number, number] => [s.latitude, s.longitude]);
	for (const f of undated) {
		const at = locations[f.id]!;
		const text = describe(f);
		const existing = stops.find((s) => s.numbers.length === 0 && sameSpot(s, at));
		if (existing) existing.lines.push(text);
		else stops.push({ ...at, group: lifeGroupOf(f.type), numbers: [], lines: [text] });
		items.push({ n: null, text });
	}
	return { stops, path, items };
}
