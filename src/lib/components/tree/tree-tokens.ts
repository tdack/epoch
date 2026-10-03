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

export function treeTokenStyle(): string {
	return Object.entries(TREE_TOKENS)
		.map(([name, value]) => `${name}:${value}`)
		.join(';');
}
