/**
 * How a tree is drawn: the flat hourglass, or one of the WebGL views: rings (ADR-032) and the Ball,
 * Ribbons and Orrery alternatives. Shared by the server, which stores a member's choice and the
 * tree's default, and the page, which turns them into the view on screen. A stored or linked mode
 * that is no longer here (Layers and Floors, ADR-047) parses as none, so the next choice in line
 * applies.
 */

export const LAYOUT_MODES = {
	FLAT: 'flat',
	RINGS: 'rings',
	POINCARE: 'poincare',
	RIBBONS: 'ribbons',
	ORRERY: 'orrery'
} as const;
export type LayoutMode = (typeof LAYOUT_MODES)[keyof typeof LAYOUT_MODES];

export const LAYOUT_MODE_VALUES = Object.values(LAYOUT_MODES) as [LayoutMode, ...LayoutMode[]];

/**
 * Generations each way that arriving at a WebGL view asks for, when fewer are set. The overviews
 * are for the depth of the family, which three generations each way barely shows; a later change
 * in the steppers is kept.
 */
export const RINGS_ARRIVAL_DEPTH = 5;

/**
 * What differs between the views, in one place so a new view is one row and not a hunt through the
 * toolbar, the URL parser and the page for `=== RINGS` checks.
 */
export interface ViewModeTraits {
	/** Drawn by three.js; the people are named by DOM buttons over a canvas. */
	isWebGl: boolean;
	/** Draws side branches and partners' families at all; only the hourglass leaves them out. */
	hasWiderGroups: boolean;
	/** Arriving asks for the wider groups (side branches, partners' families) when none are set. */
	shouldAskWiderGroups: boolean;
	/** Generations each way that arriving asks for at least; null leaves the depth alone. */
	arrivalDepth: number | null;
	/** The drawing offers editing gestures (the context menu); the overviews do not. */
	canEdit: boolean;
}

const WEBGL_TRAITS: ViewModeTraits = {
	isWebGl: true,
	hasWiderGroups: true,
	shouldAskWiderGroups: true,
	arrivalDepth: RINGS_ARRIVAL_DEPTH,
	canEdit: false
};

export const VIEW_MODE_TRAITS: Record<LayoutMode, ViewModeTraits> = {
	flat: {
		isWebGl: false,
		hasWiderGroups: false,
		shouldAskWiderGroups: false,
		arrivalDepth: null,
		canEdit: true
	},
	rings: WEBGL_TRAITS,
	poincare: WEBGL_TRAITS,
	ribbons: WEBGL_TRAITS,
	orrery: WEBGL_TRAITS
};

/** The WebGL views in the order the 3D picker lists them. */
export const WEBGL_LAYOUT_MODES: readonly LayoutMode[] = LAYOUT_MODE_VALUES.filter(
	(mode) => VIEW_MODE_TRAITS[mode].isWebGl
);

/** The stored or typed value as a mode, or null when it is absent or not one (a column holds text). */
export function parseLayoutMode(value: unknown): LayoutMode | null {
	return LAYOUT_MODE_VALUES.find((mode) => mode === value) ?? null;
}

/**
 * The view to draw. What the address says wins, so a shared link or a Back step lands as it was;
 * then the member's own setting; then the tree's default; and flat when nobody has chosen.
 */
export function resolveLayoutMode(choices: {
	fromAddress: LayoutMode | null;
	fromMember: LayoutMode | null;
	fromTree: LayoutMode | null;
}): LayoutMode {
	return choices.fromAddress ?? choices.fromMember ?? choices.fromTree ?? LAYOUT_MODES.FLAT;
}
