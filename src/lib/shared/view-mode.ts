/**
 * How a tree is drawn: the flat hourglass, one of the two CSS 3D views (S16), or the WebGL rings
 * overview (ADR-032). Shared by the server, which stores a member's choice and the tree's default,
 * and the page, which turns them into the view on screen.
 */

export const LAYOUT_MODES = {
	FLAT: 'flat',
	LAYERS: 'layers',
	FLOORS: 'floors',
	RINGS: 'rings'
} as const;
export type LayoutMode = (typeof LAYOUT_MODES)[keyof typeof LAYOUT_MODES];

export const LAYOUT_MODE_VALUES = Object.values(LAYOUT_MODES) as [LayoutMode, ...LayoutMode[]];

/**
 * The views the toolbar and the default-view pickers offer. Layers and Floors are withdrawn from
 * the controls while the owner decides on them (ADR-032), not removed: a link or a saved default
 * naming one still opens it, and the control then shows it so the view in force stays visible.
 */
const OFFERED_LAYOUT_MODES: readonly LayoutMode[] = [LAYOUT_MODES.FLAT, LAYOUT_MODES.RINGS];

/** The modes a picker lists: the offered ones, plus `current` when it is a withdrawn one. */
export function layoutModeChoices(current: LayoutMode | null): LayoutMode[] {
	return LAYOUT_MODE_VALUES.filter(
		(mode) => OFFERED_LAYOUT_MODES.includes(mode) || mode === current
	);
}

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
