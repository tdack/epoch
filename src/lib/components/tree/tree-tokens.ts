/**
 * Colour tokens for the family-tree canvas, applied as CSS custom properties on the canvas root
 * (see {@link treeTokenStyle}). Kept in TypeScript rather than a stylesheet so the contrast
 * tests read the exact values the page uses.
 *
 * Sex is a muted pastel fill plus a symbol. Parent-child types avoid blue and pink and lean on
 * line style first, so a line never reads as a sex.
 */
export const TREE_TOKENS = {
	'--tree-bg': '#f7f3ea',
	'--tree-dot': '#d6cebf',
	'--tree-ink': '#1c1917',
	'--tree-ink-muted': '#57534e',
	'--tree-panel': '#fdfbf7',
	'--tree-panel-border': '#d6d3d1',
	'--tree-accent': '#0f766e',
	'--tree-focus-ring': '#0f172a',

	'--sex-m': '#dbe8f5',
	'--sex-m-border': '#5a84b5',
	'--sex-f': '#f6dde6',
	'--sex-f-border': '#b8607f',
	'--sex-u': '#ebe7e0',
	'--sex-u-border': '#7d756a',

	'--rel-biological': '#44403c',
	'--rel-adoptive': '#4d7c4f',
	'--rel-foster': '#a16207',
	'--rel-guardian': '#475569',
	'--rel-unknown': '#80858e',
	'--rel-mixed': '#44403c',

	'--union-ink': '#8a5a14',
	'--union-fill': '#fdfbf7',
	'--partner-line': '#8a5a14'
} as const;

/**
 * How the 3D views look at the stage: the fixed cameras and how far each band recedes. Tokens, not
 * constants in the geometry module, so the contrast test reads the exact fade the page draws.
 * Rotations are degrees: X tips the stage back, Y turns it about the vertical.
 */
export const CAMERA_TOKENS = {
	floors: { rotateXDeg: 33, rotateYDeg: 0 },
	'layers-front': { rotateXDeg: 2, rotateYDeg: -3 },
	'layers-angled': { rotateXDeg: 5, rotateYDeg: -13 },
	'layers-exploded': { rotateXDeg: 7, rotateYDeg: -17 }
} as const;

/**
 * Opacity of a band's cards, so the sibling and cousin lines recede behind the direct line. Text
 * fades with its card, so the contrast test blends it over the canvas before it measures.
 */
export const BAND_FADE = { 0: 1, 1: 0.9, 2: 0.88 } as const;

/**
 * Colours of the rings overview (ADR-032). A sphere is coloured by sex, as a card is, using the
 * card borders' stronger shades so a small sphere still reads; the focus person's line is carried
 * by the lines (ancestors, descendants, partnerships), a halo on the focus, and fading everyone
 * else. Hex strings, since WebGL reads them directly.
 */
export const RING_TOKENS = {
	stage: TREE_TOKENS['--tree-bg'],
	focus: TREE_TOKENS['--tree-ink'],
	male: TREE_TOKENS['--sex-m-border'],
	female: TREE_TOKENS['--sex-f-border'],
	unknownSex: TREE_TOKENS['--sex-u-border'],
	ancestor: TREE_TOKENS['--union-ink'],
	descendant: TREE_TOKENS['--tree-accent'],
	partner: '#7c3a72',
	private: '#d6d3d1',
	disc: '#cfc6b6',
	line: '#b5aea4'
} as const;

/** How far an unlit sphere and line fade, and how see-through a generation's disc is. */
export const RING_FADE = { person: 0.4, line: 0.35, disc: 0.22, rim: 0.6 } as const;

/**
 * Colours and sizes of the Ball view, the unit ball of calendar time.
 * Owned by the Ball view alone: it adds its colours and sizes here, and no other view edits this block.
 */
export const POINCARE_TOKENS = {
	stage: TREE_TOKENS['--tree-bg'],
	/** The glass shell and the fresnel rim that brightens its edge. */
	glass: '#6f8fae',
	glassOpacity: { base: 0.05, rim: 0.42 },
	/** Latitude rings and the time axis, drawn as hairlines. */
	latitude: '#8f9aa6',
	latitudeOpacity: { decade: 0.2, major: 0.5, axis: 0.35 },
	/** Calendar years on the rings: real years, never anyone's estimated era. */
	yearInk: '#57534e'
} as const;

/** Line widths on the rings, in CSS pixels: the focus line, and everyone else's. */
export const RING_LINE_WIDTH_PX = { lit: 3, unlit: 1.5 } as const;

/**
 * Colours and sizes of the Ribbons view, lineages as tubes meeting at union knots.
 * Owned by the Ribbons view alone: it adds its colours and sizes here, and no other view edits this block.
 */
export const RIBBON_TOKENS = {
	// Dark, because the knots' glow is additive and would vanish on the cream the other views use.
	stage: '#10141f',
	// Light where RING_TOKENS.focus is dark ink, which would disappear on the dark stage.
	focus: '#f4eedc',
	knot: '#ffe7ad',
	glow: '#ffbd5c'
} as const;

/** How faint an unlit ribbon, knot and glow are, as a fraction of the lit ones. */
export const RIBBON_FADE = { person: 0.4, knot: 0.55, glow: 0.4 } as const;

/** Sizes of the Ribbons view in scene units: tube radii taper from the oldest row to the youngest. */
export const RIBBON_SIZES = {
	tubeOldest: 0.2,
	tubeYoungest: 0.09,
	node: 0.46,
	knot: 0.42,
	glow: 4.2,
	braid: 0.34
} as const;

export function treeTokenStyle(): string {
	return Object.entries(TREE_TOKENS)
		.map(([name, value]) => `${name}:${value}`)
		.join(';');
}

/**
 * Colours and sizes of the Orrery view, a star cluster of partners and their children.
 * Owned by the Orrery view alone: it adds its colours and sizes here, and no other view edits this block.
 */
export const ORRERY_TOKENS = {
	/** Night sky: the glow sprites are additive, so they only read against a dark stage. */
	stage: '#090d1b',
	/** Star colours by sex, lighter than the cards' borders because a star glows rather than fills. */
	male: '#8dbbff',
	female: '#ff9cc2',
	unknownSex: '#e8e1d2',
	private: '#7b8296',
	/** Descent lines and tethers on the focus person's line, and everyone else's. */
	lineLit: '#ffe0a0',
	lineDim: '#56648c',
	/** The accretion ring at a union's barycentre, and the pulse that runs along a tether. */
	accretion: '#a9bdf0',
	pulse: '#ffffff',
	focusHalo: '#ffffff',
	/** The legend sits on the light panel, where a white halo would vanish. */
	legendHalo: TREE_TOKENS['--tree-ink'],
	starRadiusUnits: 0.42,
	focusScale: 1.5,
	/** A glow sprite's width as a multiple of the star's radius. */
	glowScale: 7,
	/** How bright a star, its glow and its lines are when off the focus line, 0 to 1. */
	dimStar: 0.55,
	dimGlow: 0.3,
	dimLine: 0.35,
	litLinePx: 3,
	dimLinePx: 1.6,
	tetherPx: 3.4,
	/** Seconds for a tether's pulse to run from one partner to the other. */
	pulseSeconds: 4,
	accretionOpacity: 0.2
} as const;
