/**
 * The colour and motion settings (ADR-053) as both sides see them: the stored shapes, the contrast
 * floors and soft warnings, and the presets. Shared so the settings page shows exactly the numbers
 * the server enforces on save; the server alone decides, by refusing a breach.
 */

import {
	DEFAULT_PALETTE,
	type FocusShades,
	type Palette,
	type SexBases,
	type SexKey
} from '#lib/components/tree/palette.js';
import { contrastRatio, oklabDistance } from './colour.js';

export interface TracePaletteSettings {
	trace: string[];
	intersection: string;
}

/** One layer's stored choices. A group that is absent inherits from the layer below. */
export interface SettingsDocument {
	sexColours?: SexBases;
	tracePalette?: TracePaletteSettings;
	focusColours?: FocusShades;
	/** A user's own choice only; the site default has no motion setting. */
	isMotionReduced?: boolean;
}

/**
 * A request to change a layer. A group that is present replaces the stored one; `null` clears it so
 * it inherits again; an absent key leaves the stored group alone.
 */
export interface SettingsPatch {
	sexColours?: SexBases | null;
	tracePalette?: TracePaletteSettings | null;
	focusColours?: FocusShades | null;
	isMotionReduced?: boolean | null;
}

/** What the settings page reads: each layer as stored, and the choices the caller ends up with. */
export interface SettingsView {
	/** The caller's own layer; empty for the public visitor. */
	user: SettingsDocument;
	site: SettingsDocument;
	effective: {
		sexColours: SexBases;
		tracePalette: TracePaletteSettings;
		focusColours: FocusShades;
		isMotionReduced: boolean;
	};
}

export const COLOUR_GROUPS = ['sexColours', 'tracePalette', 'focusColours'] as const;
export type ColourGroup = (typeof COLOUR_GROUPS)[number];

export const SEX_COLOUR_LABELS: Readonly<Record<SexKey, string>> = {
	male: 'Male',
	female: 'Female',
	unknown: 'Unknown or other'
};

/**
 * WCAG's floors at the sizes the views draw: a card border against its fill (a graphical object,
 * 3:1), the card's ink on its fill (body text, 4.5:1), and each sphere or star against both dark
 * stages (3:1).
 */
export const CONTRAST_FLOORS = { border: 3, ink: 4.5, sphere: 3 } as const;
export type ContrastCheck = keyof typeof CONTRAST_FLOORS;

/** The card ink and the two dark stages; the same values tree-tokens.ts paints with. */
const CARD_INK = '#1c1917';
const DARK_STAGES = ['#10141f', '#090d1b'] as const;

/**
 * Below this OKLab distance two colours are reported as hard to tell apart. Set just under the
 * closest pair the built-in palette has (about 0.09), so the defaults raise no warning.
 */
const CLOSE_COLOUR_DISTANCE = 0.08;

export type SexContrast = Readonly<Record<ContrastCheck, number>>;

/** The three contrast ratios of one sex's shades; the sphere figure is the worst stage and shade. */
export function sexContrast(palette: Palette, key: SexKey): SexContrast {
	const shades = palette.sex[key];
	const onStages = DARK_STAGES.flatMap((stage) => [
		contrastRatio(shades.sphere, stage),
		contrastRatio(shades.star, stage)
	]);
	return {
		border: contrastRatio(shades.border, shades.fill),
		ink: contrastRatio(CARD_INK, shades.fill),
		sphere: Math.min(...onStages)
	};
}

export interface FloorBreach {
	readonly sex: SexKey;
	readonly check: ContrastCheck;
	readonly message: string;
}

const BREACH_ADVICE: Readonly<Record<ContrastCheck, string>> = {
	border: `the card border is too close to its fill (needs ${CONTRAST_FLOORS.border}:1). Choose a darker or more saturated colour.`,
	ink: `the card text does not read on its fill (needs ${CONTRAST_FLOORS.ink}:1). Choose a paler colour.`,
	sphere: `the sphere is too dark to show on the 3D stage (needs ${CONTRAST_FLOORS.sphere}:1). Choose a lighter colour.`
};

/** Every floor the palette's sex colours break, each naming the sex and what to change. */
export function floorBreaches(palette: Palette): FloorBreach[] {
	const breaches: FloorBreach[] = [];
	for (const sex of ['male', 'female', 'unknown'] as const) {
		const ratios = sexContrast(palette, sex);
		for (const check of ['border', 'ink', 'sphere'] as const)
			if (ratios[check] < CONTRAST_FLOORS[check])
				breaches.push({
					sex,
					check,
					message: `${SEX_COLOUR_LABELS[sex]}: ${BREACH_ADVICE[check]}`
				});
	}
	return breaches;
}

/**
 * Soft warnings: trace colours that look alike, or a trace colour that looks like a sex colour.
 * Text only; nothing is adjusted, because a person may choose them on purpose.
 */
export function paletteWarnings(palette: Palette): string[] {
	const warnings: string[] = [];
	palette.trace.forEach((colour, index) => {
		for (let other = index + 1; other < palette.trace.length; other++)
			if (oklabDistance(colour, palette.trace[other]) < CLOSE_COLOUR_DISTANCE)
				warnings.push(`Trace colours ${index + 1} and ${other + 1} are hard to tell apart.`);
		for (const sex of ['male', 'female', 'unknown'] as const)
			if (oklabDistance(colour, palette.sex[sex].border) < CLOSE_COLOUR_DISTANCE)
				warnings.push(
					`Trace colour ${index + 1} looks like the ${SEX_COLOUR_LABELS[sex].toLowerCase()} colour.`
				);
	});
	return warnings;
}

export interface ColourPreset {
	readonly id: string;
	readonly label: string;
	readonly groups: {
		readonly sexColours: SexBases;
		readonly tracePalette: TracePaletteSettings;
		readonly focusColours: FocusShades;
	};
}

/** The base colours of the built-in palette, in the shape a settings layer stores. */
export const BUILT_IN_GROUPS: ColourPreset['groups'] = {
	sexColours: {
		male: DEFAULT_PALETTE.sex.male.border,
		female: DEFAULT_PALETTE.sex.female.border,
		unknown: DEFAULT_PALETTE.sex.unknown.border
	},
	tracePalette: { trace: [...DEFAULT_PALETTE.trace], intersection: DEFAULT_PALETTE.intersection },
	focusColours: { ...DEFAULT_PALETTE.focus }
};

/**
 * The two starting points the page offers. The colour-blind safe set takes Okabe-Ito's blue and a
 * darkened vermilion for the sexes, the pair that stays apart for the common colour-vision
 * differences; the vermilion is darkened so the card border meets its floor. Its trace set drops
 * the blue and vermilion the sexes now use, so no trace colour reads as a sex.
 */
export const COLOUR_PRESETS: readonly ColourPreset[] = [
	{
		id: 'default',
		label: 'Default',
		groups: BUILT_IN_GROUPS
	},
	{
		id: 'colour-blind-safe',
		label: 'Colour-blind safe',
		groups: {
			sexColours: { male: '#0072b2', female: '#b85500', unknown: '#777777' },
			tracePalette: {
				trace: ['#e69f00', '#009e73', '#56b4e9', '#f0e442', '#cc79a7', '#7b5fd1'],
				intersection: BUILT_IN_GROUPS.tracePalette.intersection
			},
			focusColours: BUILT_IN_GROUPS.focusColours
		}
	}
];
