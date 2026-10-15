/**
 * The resolved colours every tree view paints with. Built-in defaults come from tree-tokens.ts;
 * an install owner may set the site default and a signed-in user may set their own (ADR-053), and
 * {@link resolvePalette} layers them: user over site over built-in, one group at a time.
 *
 * Defaults are literal values, not derived from one another, so the default rendering is the one
 * the views have always had. A changed base colour derives its other shades (see {@link deriveSex}).
 */

import { HIGHLIGHT_TOKENS, ORRERY_TOKENS, RING_TOKENS, TREE_TOKENS } from './tree-tokens.js';
import { isHexColour, lightenHex, mixHex } from '#lib/shared/colour.js';

export const SEX_KEYS = ['male', 'female', 'unknown'] as const;
export type SexKey = (typeof SEX_KEYS)[number];

export interface SexShades {
	/** The pale card fill. */
	readonly fill: string;
	/** The card border, and the sphere in the 3D views. */
	readonly border: string;
	/** The sphere colour; the same as the border, named apart so each view says what it wants. */
	readonly sphere: string;
	/** The Orrery star, lighter because a star glows rather than fills. */
	readonly star: string;
}

export interface FocusShades {
	readonly ancestor: string;
	readonly descendant: string;
	readonly partner: string;
}

export type TraceTuple = readonly [string, string, string, string, string, string];

export interface Palette {
	readonly sex: Readonly<Record<SexKey, SexShades>>;
	readonly trace: TraceTuple;
	readonly intersection: string;
	/** The focus line on the cream stage and in the flat view. */
	readonly focus: FocusShades;
	/** The same lines lifted for the dark 3D stages, where the cream-stage hues vanish. */
	readonly focusDark: FocusShades;
	/** The flat view's partnership line. Not user-editable; it stays as it was. */
	readonly flatPartnerLine: string;
	readonly private: string;
}

/** The base colour chosen for one sex: the card border and sphere colour. */
export type SexBases = Readonly<Record<SexKey, string>>;

/** One layer of settings: every group optional, so a missing group inherits from the layer below. */
export interface PaletteSettings {
	sexColours?: Partial<SexBases>;
	tracePalette?: { trace?: readonly string[]; intersection?: string };
	focusColours?: Partial<FocusShades>;
}

const DEFAULT_SEX_BASES: SexBases = {
	male: TREE_TOKENS['--sex-m-border'],
	female: TREE_TOKENS['--sex-f-border'],
	unknown: TREE_TOKENS['--sex-u-border']
};

const DEFAULT_SEX: Readonly<Record<SexKey, SexShades>> = {
	male: {
		fill: TREE_TOKENS['--sex-m'],
		border: TREE_TOKENS['--sex-m-border'],
		sphere: RING_TOKENS.male,
		star: ORRERY_TOKENS.male
	},
	female: {
		fill: TREE_TOKENS['--sex-f'],
		border: TREE_TOKENS['--sex-f-border'],
		sphere: RING_TOKENS.female,
		star: ORRERY_TOKENS.female
	},
	unknown: {
		fill: TREE_TOKENS['--sex-u'],
		border: TREE_TOKENS['--sex-u-border'],
		sphere: RING_TOKENS.unknownSex,
		star: ORRERY_TOKENS.unknownSex
	}
};

const DEFAULT_FOCUS: FocusShades = {
	ancestor: HIGHLIGHT_TOKENS.focus.ancestor,
	descendant: HIGHLIGHT_TOKENS.focus.descendant,
	partner: HIGHLIGHT_TOKENS.focus.partner
};

const DEFAULT_FOCUS_DARK: FocusShades = {
	ancestor: RING_TOKENS.dark.ancestor,
	descendant: RING_TOKENS.dark.descendant,
	partner: RING_TOKENS.dark.partner
};

/** How far a derived card fill is mixed toward white. */
const DERIVED_FILL_MIX = 0.8;
/** How far a derived star is lightened toward white; the built-in stars sit about here. */
const DERIVED_STAR_LIGHTEN = 0.45;
/** How far a derived dark-stage focus colour is lifted toward white. */
const DERIVED_DARK_LIFT = 0.4;

/** The shades a changed base colour yields; the built-in base keeps the literal built-in shades. */
function deriveSex(key: SexKey, base: string): SexShades {
	if (base === DEFAULT_SEX_BASES[key]) return DEFAULT_SEX[key];
	return {
		fill: mixHex(base, '#ffffff', DERIVED_FILL_MIX),
		border: base,
		sphere: base,
		star: lightenHex(base, DERIVED_STAR_LIGHTEN)
	};
}

/** The first layer that sets the group, or undefined. A group is taken whole from one layer. */
function layerGroup<K extends keyof PaletteSettings>(
	layers: readonly (PaletteSettings | null | undefined)[],
	key: K
): PaletteSettings[K] | undefined {
	for (const layer of layers) {
		const group = layer?.[key];
		if (group !== undefined) return group;
	}
	return undefined;
}

/** A colour from the chosen group if it is valid hex, else the fallback. Never returns junk. */
function hexOr(candidate: string | undefined, fallback: string): string {
	return candidate !== undefined && isHexColour(candidate) ? candidate.toLowerCase() : fallback;
}

/**
 * Layers the settings over the built-in palette, group by group: a user's group wins over the
 * site's, which wins over the built-in. A value that is not six-digit hex falls back to the built-in
 * one, so an invalid stored colour never reaches a style attribute.
 */
export function resolvePalette(
	...layers: readonly (PaletteSettings | null | undefined)[]
): Palette {
	const sex = layerGroup(layers, 'sexColours');
	const trace = layerGroup(layers, 'tracePalette');
	const focus = layerGroup(layers, 'focusColours');

	const sexBase = (key: SexKey) => hexOr(sex?.[key], DEFAULT_SEX_BASES[key]);
	const focusValue = (key: keyof FocusShades) => hexOr(focus?.[key], DEFAULT_FOCUS[key]);

	const focusShades: FocusShades = {
		ancestor: focusValue('ancestor'),
		descendant: focusValue('descendant'),
		partner: focusValue('partner')
	};
	const lifted = (key: keyof FocusShades): string =>
		focusShades[key] === DEFAULT_FOCUS[key]
			? DEFAULT_FOCUS_DARK[key]
			: lightenHex(focusShades[key], DERIVED_DARK_LIFT);

	const traceSlot = (slot: number) => hexOr(trace?.trace?.[slot], HIGHLIGHT_TOKENS.trace[slot]);

	return {
		sex: {
			male: deriveSex('male', sexBase('male')),
			female: deriveSex('female', sexBase('female')),
			unknown: deriveSex('unknown', sexBase('unknown'))
		},
		trace: [traceSlot(0), traceSlot(1), traceSlot(2), traceSlot(3), traceSlot(4), traceSlot(5)],
		intersection: hexOr(trace?.intersection, HIGHLIGHT_TOKENS.intersection),
		focus: focusShades,
		focusDark: {
			ancestor: lifted('ancestor'),
			descendant: lifted('descendant'),
			partner: lifted('partner')
		},
		flatPartnerLine: TREE_TOKENS['--partner-line'],
		private: RING_TOKENS.private
	};
}

/** The built-in palette: exactly what every view painted before the settings page existed. */
export const DEFAULT_PALETTE: Palette = {
	sex: DEFAULT_SEX,
	trace: HIGHLIGHT_TOKENS.trace,
	intersection: HIGHLIGHT_TOKENS.intersection,
	focus: DEFAULT_FOCUS,
	focusDark: DEFAULT_FOCUS_DARK,
	flatPartnerLine: TREE_TOKENS['--partner-line'],
	private: RING_TOKENS.private
};

/**
 * The CSS custom properties a tree view's root carries. Each palette colour is checked again here,
 * because it is written into a style attribute: a value that is not six-digit hex falls back to the
 * built-in one rather than reaching the page.
 */
export function treeTokenStyle(palette: Palette = DEFAULT_PALETTE): string {
	const safe = (value: string, fallback: string) => (isHexColour(value) ? value : fallback);
	const sex = (key: SexKey, field: keyof SexShades) =>
		safe(palette.sex[key][field], DEFAULT_SEX[key][field]);
	const vars: Record<string, string> = {
		...TREE_TOKENS,
		'--sex-m': sex('male', 'fill'),
		'--sex-m-border': sex('male', 'border'),
		'--sex-f': sex('female', 'fill'),
		'--sex-f-border': sex('female', 'border'),
		'--sex-u': sex('unknown', 'fill'),
		'--sex-u-border': sex('unknown', 'border'),
		'--union-ink': safe(palette.focus.ancestor, DEFAULT_FOCUS.ancestor),
		'--tree-accent': safe(palette.focus.descendant, DEFAULT_FOCUS.descendant),
		'--partner-line': safe(palette.flatPartnerLine, DEFAULT_PALETTE.flatPartnerLine)
	};
	return Object.entries(vars)
		.map(([name, value]) => `${name}:${value}`)
		.join(';');
}
