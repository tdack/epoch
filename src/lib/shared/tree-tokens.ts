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
	'--tree-dot': '#c2b7a0',
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
	line: '#b5aea4',
	/**
	 * The dark stage Rings draws on (Ribbons and Orrery are dark too). The keys above stay as they
	 * are because the Ball and the legend panel, which is light, still read them; these are what the
	 * Rings scene uses. Each highlight colour is a lifted shade of its light-stage namesake, since
	 * the browns and purples of the focus line vanish on navy.
	 */
	dark: {
		stage: '#10141f',
		/** A generation's disc and its rim, quiet enough that the spheres stay the brightest thing. */
		disc: '#8d9bc4',
		rim: '#6f7ca3',
		/** Plain parent-child and partnership lines, nobody highlighted. */
		line: '#8791b0',
		focus: '#f4eedc',
		ancestor: '#f0b955',
		descendant: '#45cdb8',
		partner: '#e196d6'
	}
} as const;

/** How far an unlit sphere and line fade, and how see-through a generation's disc is. */
export const RING_FADE = { person: 0.4, line: 0.35, disc: 0.07, rim: 0.5 } as const;

/**
 * Colours and sizes of the Ball view, the unit ball of calendar time.
 * Owned by the Ball view alone: it adds its colours and sizes here, and no other view edits this block.
 */
export const POINCARE_TOKENS = {
	// Dark like Ribbons and Orrery: the glass is a faint blue veil there, where on cream it was a
	// bright blue shell that outshone the people inside it.
	stage: '#10141f',
	/** The glass shell and the fresnel rim that brightens its edge. */
	glass: '#6f8fae',
	glassOpacity: { base: 0.012, rim: 0.14 },
	/** Latitude rings and the time axis, drawn as hairlines. */
	latitude: '#8aa0bd',
	latitudeOpacity: { decade: 0.14, major: 0.38, axis: 0.28 },
	/** Calendar years on the rings: real years, never anyone's estimated era. */
	yearInk: '#b6c3d6',
	/** The focus halo: light, where RING_TOKENS.focus is dark ink that would vanish on this stage. */
	focus: '#f4eedc',
	/** Parent-child and partnership lines that nothing lights. */
	line: '#7886a3',
	/** Width in CSS pixels of a line on two or more traced paths, one step above a lit line. */
	sharedLinePx: 4.5,
	/** A mark's halo is a ring this many sphere radii across; a shared mark adds a second one. */
	haloScale: 2.9,
	sharedHaloScale: 4.1
} as const;

/** Line widths on the rings, in CSS pixels: a lit line, everyone else's, and a line on two or more paths. */
export const RING_LINE_WIDTH_PX = { lit: 3, unlit: 1.5, shared: 5 } as const;

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
	braid: 0.34,
	/** A tube on two or more traced paths is drawn this many times as thick, and its knot as big. */
	sharedScale: 1.7,
	/** A lit knot is a little bigger than a plain one, so a selected partnership reads from afar. */
	litKnotScale: 1.3,
	/** The halo round a lit person, as a multiple of the node radius; a shared mark adds a second. */
	haloRadius: 1.5,
	haloSecondRadius: 1.95,
	haloTube: 0.055
} as const;

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
	accretionOpacity: 0.2,
	/**
	 * Highlight colours are made for the cream stage and the legend; on a dark stage with additive
	 * blending the darker ones (the focus line's brown and teal) would vanish. A mark's colour is
	 * mixed this far toward white, which keeps its hue.
	 */
	markLighten: 0.4,
	/** Descent lines: plain, on a mark, and on two or more paths. */
	plainLinePx: 2,
	markedLinePx: 3.6,
	sharedLinePx: 5.4,
	/** Tethers on a mark, and on two or more paths. */
	markedTetherPx: 4.8,
	sharedTetherPx: 6.2,
	/** A shared mark is drawn this much brighter than its colour alone. */
	sharedBoost: 1.3,
	/** How bright an unmarked tether is while something else is lit. */
	dimTether: 0.45,
	/** A marked star's halo, as a multiple of the star's radius; shared adds a second, larger one. */
	haloScale: 1.7,
	sharedHaloScale: 2.3,
	haloTube: 0.04,
	/** A partnership's hit target, as a multiple of a star's radius: at least a star's size. */
	unionHitScale: 1.4,
	/** The knot at a partnership's barycentre, which is the marker the viewer sees and clicks. */
	knotRadiusUnits: 0.2,
	/** Emissive and glow of a star on a soft mark (the upstream path), against a full one. */
	softStar: 0.85,
	softGlow: 0.55
} as const;

/**
 * Colours shared by every WebGL view's highlights (trace mode, partnership and line selection).
 * Sex colours belong to the spheres, so none of these is pink, blue or grey: a highlight shows as
 * halos and line colours, never as a sex. The trace palette follows the Okabe-Ito set, which stays
 * apart for the common colour-vision differences, and every entry reads on both the cream stage
 * and the dark ones.
 */
export const HIGHLIGHT_TOKENS = {
	/** One per traced item, in the order items were added. */
	trace: ['#e69f00', '#00a57a', '#d55e00', '#f0e442', '#7b5fd1', '#2f6fd0'],
	/** Where two or more traced paths meet. */
	intersection: '#c026d3',
	/** The focus line, which stays what it has always been. */
	focus: {
		ancestor: RING_TOKENS.ancestor,
		descendant: RING_TOKENS.descendant,
		partner: RING_TOKENS.partner
	},
	/** The partnership selected, and what is downstream of a selected line or partnership. */
	descendant: RING_TOKENS.descendant,
	/** What is upstream of a selected line, which has no partner of its own to take a colour from. */
	ancestor: RING_TOKENS.ancestor,
	partner: RING_TOKENS.partner,
	/** Opacity of a `soft` mark (the upstream path) as a fraction of a `full` one. */
	softOpacity: 0.5
} as const;
