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

export function treeTokenStyle(): string {
	return Object.entries(TREE_TOKENS)
		.map(([name, value]) => `${name}:${value}`)
		.join(';');
}
