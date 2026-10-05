/**
 * How a tree is drawn: the flat hourglass or one of the two 3D views (S16). Shared by the server,
 * which stores a member's choice and the tree's default, and the page, which turns them into the
 * view on screen.
 */

export const LAYOUT_MODES = { FLAT: 'flat', LAYERS: 'layers', FLOORS: 'floors' } as const;
export type LayoutMode = (typeof LAYOUT_MODES)[keyof typeof LAYOUT_MODES];

export const LAYOUT_MODE_VALUES = Object.values(LAYOUT_MODES) as [LayoutMode, ...LayoutMode[]];

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
