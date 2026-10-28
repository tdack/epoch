/**
 * One invented family and where each of Epoch's ways of seeing a family puts its people. The
 * shapes follow the app on `main`: `chart-layout.ts` (ancestors and descendants grow left to right,
 * the hourglass puts descendants on the left), `fan-layout.ts` (a half circle, the first parent on
 * the left, radial names from the fourth generation) and the relationship page's list of steps.
 * Sizes are larger than the app's so the drawing still reads once it is scaled into the page.
 */

type Sex = 'm' | 'f' | 'u';

export interface FamilyPerson {
	id: string;
	name: string;
	sex: Sex;
	birth: string | null;
	death: string | null;
	/** Shown as the app shows someone the viewer may not see: a placeholder named "Private". */
	isPrivate?: boolean;
}

export const PEOPLE: FamilyPerson[] = [
	{ id: 'ellen', name: 'Ellen Marsh', sex: 'f', birth: 'ABT 1874', death: '1951' },
	{ id: 'william', name: 'William Marsh', sex: 'm', birth: '1840', death: '1902' },
	{ id: 'mary', name: 'Mary Holt', sex: 'f', birth: 'ABT 1845', death: '1910' },
	{ id: 'john', name: 'John Marsh', sex: 'm', birth: '1812', death: '1880' },
	{ id: 'ann', name: 'Ann Pike', sex: 'f', birth: '1815', death: '1871' },
	{ id: 'george', name: 'George Holt', sex: 'm', birth: '1818', death: '1889' },
	{ id: 'sarah', name: 'Sarah Dene', sex: 'f', birth: 'BET 1820 AND 1822', death: null },
	{ id: 'edward', name: 'Edward Marsh', sex: 'm', birth: 'ABT 1785', death: null },
	{ id: 'robert', name: 'Robert Pike', sex: 'm', birth: '1790', death: '1851' },
	{ id: 'jane', name: 'Jane Lowe', sex: 'f', birth: 'ABT 1792', death: '1860' },
	{ id: 'samuel', name: 'Samuel Holt', sex: 'm', birth: 'BET 1788 AND 1791', death: null },
	{ id: 'martha', name: 'Martha Crane', sex: 'f', birth: '1793', death: '1866' },
	{ id: 'thomasd', name: 'Thomas Dene', sex: 'm', birth: '1796', death: '1860' },
	{ id: 'thomas', name: 'Thomas Reed', sex: 'm', birth: '1871', death: '1932' },
	{ id: 'arthur', name: 'Arthur Vale', sex: 'm', birth: '1869', death: '1940' },
	{ id: 'rose', name: 'Rose Reed', sex: 'f', birth: 'ABT 1900', death: '1977' },
	{ id: 'henry', name: 'Henry Reed', sex: 'm', birth: '1899', death: '1968' },
	{ id: 'jack', name: 'Jack Vale', sex: 'm', birth: 'BET 1908 AND 1910', death: null },
	{ id: 'nell', name: 'Nell Price', sex: 'f', birth: '1912', death: '1990' },
	{ id: 'alice', name: 'Alice Dunn', sex: 'f', birth: '1925', death: '2011' },
	{ id: 'tom', name: 'Tom Reed', sex: 'm', birth: '1931', death: '2002' },
	{ id: 'molly', name: 'Molly Vale', sex: 'f', birth: 'ABT 1936', death: '2019' },
	{ id: 'lily', name: 'Private', sex: 'u', birth: null, death: null, isPrivate: true }
];

/** Steps from Ellen, the person in focus; the explorer moves the nearest people first. */
export const DISTANCE: Record<string, number> = {
	ellen: 0,
	william: 1,
	mary: 1,
	thomas: 1,
	arthur: 1,
	rose: 1,
	henry: 1,
	jack: 1,
	nell: 1,
	john: 2,
	ann: 2,
	george: 2,
	sarah: 2,
	alice: 2,
	tom: 2,
	molly: 2,
	lily: 2,
	edward: 3,
	robert: 3,
	jane: 3,
	samuel: 3,
	martha: 3,
	thomasd: 3
};

const byId = new Map(PEOPLE.map((p) => [p.id, p]));
const personOf = (id: string) => byId.get(id)!;

/**
 * A stored date as the app shows it (`displayDate` in `date-display.ts` on `main`): `ABT 1900` is
 * "about 1900" and `BET 1908 AND 1910` "between 1908 and 1910", never a tidied exact year. Only the
 * forms this family uses are read.
 */
const say = (text: string) =>
	text.replace(/^BET (.+) AND (.+)$/, 'between $1 and $2').replace(/^ABT /, 'about ');

/** The app's chart date line (`FanChart`, `ChartCanvas`). */
export const datesOf = (p: FamilyPerson) =>
	p.birth || p.death
		? `${p.birth ? say(p.birth) : '?'} – ${p.death ? say(p.death) : ''}`.trim()
		: '';

/**
 * The pedigree in the app's heap order: a person at i has parents at 2i+1 and 2i+2. A null slot
 * is an ancestor nobody has recorded; the app draws nothing there, and neither does this.
 */
const PEDIGREE: Array<string | null> = [
	'ellen',
	'william',
	'mary',
	'john',
	'ann',
	'george',
	'sarah',
	'edward',
	null,
	'robert',
	'jane',
	'samuel',
	'martha',
	'thomasd',
	null
];

/** Ellen's descendants in row order; each child has one child of their own here. */
const DESCENT = [
	{ child: 'rose', grandchild: 'alice' },
	{ child: 'henry', grandchild: 'tom' },
	{ child: 'jack', grandchild: 'molly' },
	{ child: 'nell', grandchild: 'lily' }
] as const;

export const STAGE = { width: 1040, height: 640 } as const;

/** How a person is drawn in a lens; the explorer blends two of these. */
export type Look = 'tree' | 'chart' | 'fan' | 'step';

export interface Place {
	/** Centre of the shape. */
	x: number;
	y: number;
	/** Turn of the shape's long axis, in radians. */
	turn: number;
	w: number;
	h: number;
	/** 1 / radius of the bend; 0 is a flat card. */
	bend: number;
	look: Look;
	/** The fan's generation, for its alternating tints. */
	ring?: number;
	/** Degrees the label is turned by; only the fan's outer ring turns its names. */
	labelTurn?: number;
	/** The lines under the name. */
	lines?: string[];
}

type Layout = Record<string, Place>;

const box = (x: number, y: number, w: number, h: number, look: Look): Place => ({
	x: x + w / 2,
	y: y + h / 2,
	turn: 0,
	w,
	h,
	bend: 0,
	look
});

/*
 * Family view: the app's flat canvas at its full level of detail (`PersonCard`, `tree-view.ts`):
 * 210 × 74 cards, generations 170 apart, partners either side of their union marker with 56
 * between them, and siblings 36 apart.
 */
export const TREE_CARD = { w: 210, h: 74 } as const;
/** The top of each generation's cards. */
export const FAMILY_ROW_Y = { parents: 33, partners: 203, children: 373, grandchildren: 543 };
export const FAMILY_X = {
	william: 387,
	mary: 653,
	thomas: 254,
	ellen: 520,
	arthur: 786,
	rose: 151,
	henry: 397,
	jack: 643,
	nell: 889
} as const;

/** The tree card's date lines: the date in words after "b." and "†", as the app writes them. */
const treeLines = (p: FamilyPerson) =>
	[p.birth && `b. ${say(p.birth)}`, p.death && `† ${say(p.death)}`].filter(
		(line): line is string => !!line
	);

const treeAt = (id: string, centreX: number, y: number): Place => ({
	...box(centreX - TREE_CARD.w / 2, y, TREE_CARD.w, TREE_CARD.h, 'tree'),
	lines: treeLines(personOf(id))
});

const family: Layout = {
	william: treeAt('william', FAMILY_X.william, FAMILY_ROW_Y.parents),
	mary: treeAt('mary', FAMILY_X.mary, FAMILY_ROW_Y.parents),
	thomas: treeAt('thomas', FAMILY_X.thomas, FAMILY_ROW_Y.partners),
	ellen: treeAt('ellen', FAMILY_X.ellen, FAMILY_ROW_Y.partners),
	arthur: treeAt('arthur', FAMILY_X.arthur, FAMILY_ROW_Y.partners),
	rose: treeAt('rose', FAMILY_X.rose, FAMILY_ROW_Y.children),
	henry: treeAt('henry', FAMILY_X.henry, FAMILY_ROW_Y.children),
	jack: treeAt('jack', FAMILY_X.jack, FAMILY_ROW_Y.children),
	nell: treeAt('nell', FAMILY_X.nell, FAMILY_ROW_Y.children),
	alice: treeAt('alice', FAMILY_X.rose, FAMILY_ROW_Y.grandchildren),
	tom: treeAt('tom', FAMILY_X.henry, FAMILY_ROW_Y.grandchildren),
	molly: treeAt('molly', FAMILY_X.jack, FAMILY_ROW_Y.grandchildren),
	lily: treeAt('lily', FAMILY_X.nell, FAMILY_ROW_Y.grandchildren)
};

const clip = (text: string, max: number) =>
	text.length > max ? `${text.slice(0, Math.max(1, max - 1))}…` : text;

/* The charts: the app's elbow-linked cards, growing left to right. */
interface Grid {
	x0: number;
	y0: number;
	w: number;
	h: number;
	columnGap: number;
	rowHeight: number;
}

/** Characters of 12px text that fit on a chart card of this width, inside its padding. */
const fits = (w: number) => Math.floor((w - 24) / 6.4);

const cardAt = (g: Grid, column: number, row: number, line: string): Place => ({
	...box(
		g.x0 + column * (g.w + g.columnGap),
		g.y0 + row * g.rowHeight + (g.rowHeight - g.h) / 2,
		g.w,
		g.h,
		'chart'
	),
	lines: line ? [clip(line, fits(g.w))] : []
});

/** A chart card's second line: the dates, and in the descendant charts the partners too. */
const chartLine = (id: string, partners: string[] = []) => {
	const dates = datesOf(personOf(id));
	if (partners.length === 0) return dates;
	const joined = partners.map((p) => personOf(p).name).join(', ');
	return `${dates}${dates ? ' · ' : ''}with ${joined}`;
};

const ELLEN_PARTNERS = ['thomas', 'arthur'];

const PEDIGREE_GRID: Grid = { x0: 42, y0: 56, w: 200, h: 54, columnGap: 52, rowHeight: 66 };
const pedigree: Layout = {};
PEDIGREE.forEach((id, i) => {
	if (!id) return;
	const generation = Math.floor(Math.log2(i + 1));
	const k = i + 1 - 2 ** generation;
	const span = 8 / 2 ** generation;
	pedigree[id] = cardAt(PEDIGREE_GRID, generation, k * span + span / 2 - 0.5, chartLine(id));
});

const DESCENDANT_GRID: Grid = { x0: 140, y0: 140, w: 200, h: 54, columnGap: 80, rowHeight: 90 };
// The app cuts the partners at 22 characters; here the person's card grows leftwards into the
// empty margin instead, so the one card that names partners names them all.
const descendants: Layout = {
	ellen: cardAt({ ...DESCENDANT_GRID, x0: 10, w: 330 }, 0, 1.5, chartLine('ellen', ELLEN_PARTNERS))
};
DESCENT.forEach(({ child, grandchild }, row) => {
	descendants[child] = cardAt(DESCENDANT_GRID, 1, row, chartLine(child));
	descendants[grandchild] = cardAt(DESCENDANT_GRID, 2, row, chartLine(grandchild));
});

// Both halves are centred on the same row, so the person sits at one height in each.
const HOURGLASS_GRID: Grid = { x0: 10, y0: 160, w: 180, h: 54, columnGap: 30, rowHeight: 80 };
const hourglass: Layout = {
	ellen: cardAt(HOURGLASS_GRID, 2, 1.5, chartLine('ellen', ELLEN_PARTNERS)),
	william: cardAt(HOURGLASS_GRID, 3, 0.5, chartLine('william')),
	mary: cardAt(HOURGLASS_GRID, 3, 2.5, chartLine('mary')),
	john: cardAt(HOURGLASS_GRID, 4, 0, chartLine('john')),
	ann: cardAt(HOURGLASS_GRID, 4, 1, chartLine('ann')),
	george: cardAt(HOURGLASS_GRID, 4, 2, chartLine('george')),
	sarah: cardAt(HOURGLASS_GRID, 4, 3, chartLine('sarah'))
};
DESCENT.forEach(({ child, grandchild }, row) => {
	hourglass[child] = cardAt(HOURGLASS_GRID, 1, row, chartLine(child));
	hourglass[grandchild] = cardAt(HOURGLASS_GRID, 0, row, chartLine(grandchild));
});

/* The fan: the person's half-disc at the bottom centre, a ring per generation above it. */
const FAN = { cx: 520, cy: 550, centreRadius: 80, ringWidth: 100 } as const;
const fan: Layout = {};
PEDIGREE.forEach((id, i) => {
	if (!id) return;
	const generation = Math.floor(Math.log2(i + 1));
	const person = personOf(id);
	if (generation === 0) {
		const r = FAN.centreRadius;
		// A half-disc is a bent card whose inner edge has shrunk to the centre.
		fan[id] = {
			x: FAN.cx,
			y: FAN.cy - r / 2,
			turn: 0,
			w: (Math.PI * r) / 2,
			h: r,
			bend: 2 / r,
			look: 'fan',
			ring: 0,
			labelTurn: 0,
			lines: [clip(datesOf(person), 17)]
		};
		return;
	}
	const n = 2 ** generation;
	const k = i + 1 - n;
	// Angles as `fan-layout.ts` measures them: anticlockwise from the right, y up.
	const start = Math.PI - (k * Math.PI) / n;
	const end = Math.PI - ((k + 1) * Math.PI) / n;
	const mid = (start + end) / 2;
	const radius = FAN.centreRadius + (generation - 1) * FAN.ringWidth + FAN.ringWidth / 2;
	const degrees = (mid * 180) / Math.PI;
	fan[id] = {
		x: FAN.cx + radius * Math.cos(mid),
		y: FAN.cy - radius * Math.sin(mid),
		turn: Math.PI / 2 - mid,
		w: radius * (start - end),
		h: FAN.ringWidth,
		bend: 1 / radius,
		look: 'fan',
		ring: generation,
		// Along the radius from the fourth generation, turned so it never reads upside down.
		labelTurn: generation <= 2 ? 0 : mid > Math.PI / 2 ? 180 - degrees : -degrees,
		lines: generation <= 2 ? [clip(datesOf(person), 17)] : []
	};
});

/* Relationship: the answer as the app's relationship page lists it, one row per step. */
export const ROUTE = [
	{ id: 'alice', relation: '' },
	{ id: 'rose', relation: 'parent of Alice Dunn' },
	{ id: 'ellen', relation: 'parent of Rose Reed' },
	{ id: 'henry', relation: 'adoptive child of Ellen Marsh' },
	{ id: 'tom', relation: 'child of Henry Reed' }
] as const;
export const ROUTE_ROWS = { x: 300, y0: 300, step: 34, w: 200, h: 28 } as const;

const relationship: Layout = {};
ROUTE.forEach(({ id }, i) => {
	relationship[id] = {
		...box(ROUTE_ROWS.x, ROUTE_ROWS.y0 + i * ROUTE_ROWS.step, ROUTE_ROWS.w, ROUTE_ROWS.h, 'step'),
		lines: []
	};
});

/** The lenses in the order the page scrolls through them. */
export const LENS_IDS = [
	'family',
	'descendants',
	'hourglass',
	'pedigree',
	'fan',
	'relationship'
] as const;
export type LensId = (typeof LENS_IDS)[number];

export const LAYOUTS: Record<LensId, Layout> = {
	family,
	descendants,
	hourglass,
	pedigree,
	fan,
	relationship
};

/** The links a chart draws, child first; the drawing works out the elbows. */
export const CHART_EDGES: Partial<Record<LensId, Array<[string, string]>>> = {
	pedigree: PEDIGREE.flatMap((id, i) =>
		id
			? [PEDIGREE[2 * i + 1], PEDIGREE[2 * i + 2]]
					.filter((parent): parent is string => !!parent)
					.map((parent): [string, string] => [id, parent])
			: []
	),
	descendants: DESCENT.flatMap(({ child, grandchild }): Array<[string, string]> => [
		[child, 'ellen'],
		[grandchild, child]
	]),
	hourglass: [
		['ellen', 'william'],
		['ellen', 'mary'],
		['william', 'john'],
		['william', 'ann'],
		['mary', 'george'],
		['mary', 'sarah'],
		...DESCENT.flatMap(({ child, grandchild }): Array<[string, string]> => [
			[child, 'ellen'],
			[grandchild, child]
		])
	]
};

/** What each lens draws, read out in place of the picture. */
export const OUTLINES: Record<LensId, string> = {
	family:
		'Ellen Marsh, the person in focus, daughter of William Marsh and Mary Holt. Her first partnership, with Thomas Reed, ended in divorce: a biological daughter, Rose, and an adopted son, Henry. Her second, with Arthur Vale: a biological son, Jack, and a foster daughter, Nell. Below them are their children Alice Dunn, Tom Reed and Molly Vale, and one private person.',
	descendants:
		'Ellen Marsh, with Thomas Reed and Arthur Vale. Her children Rose Reed, Henry Reed, Jack Vale and Nell Price, and their children Alice Dunn, Tom Reed, Molly Vale and one private person.',
	hourglass:
		'Ellen Marsh in the middle. To the right, her parents William Marsh and Mary Holt and their parents John Marsh, Ann Pike, George Holt and Sarah Dene. To the left, her children and grandchildren.',
	pedigree:
		'Ellen Marsh; her parents William Marsh and Mary Holt; her grandparents John Marsh, Ann Pike, George Holt and Sarah Dene; and six great-grandparents: Edward Marsh, Robert Pike, Jane Lowe, Samuel Holt, Martha Crane and Thomas Dene. Nobody is recorded as John Marsh’s mother or Sarah Dene’s mother.',
	fan: 'The same four generations of Ellen Marsh’s ancestors on a half circle, Ellen at the centre and her father’s side on the left. Two wedges in the outer ring are empty.',
	relationship:
		'Tom Reed is Alice Dunn’s 1st cousin, through Thomas Reed and Ellen Marsh, by a route that includes an adoptive link: Alice Dunn; her parent Rose Reed; Rose’s parent Ellen Marsh; Ellen’s adoptive child Henry Reed; and Henry’s child Tom Reed.'
};
