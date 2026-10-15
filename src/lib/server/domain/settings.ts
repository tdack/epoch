/**
 * The colour and motion choices a person or the install owner makes (ADR-053), as pure data with
 * the two business rules that guard them: a patch replaces or clears whole groups, and a palette
 * must keep its cards, ink and spheres legible. No storage or request handling in here.
 */

import { resolvePalette, type FocusShades, type SexBases } from '#lib/components/tree/palette.js';
import { contrastRatio } from '#lib/shared/colour.js';
import { ValidationError } from './errors';

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

/** Applies a patch to a stored document. Pure: the caller decides what to persist. */
export function applyPatch(current: SettingsDocument, patch: SettingsPatch): SettingsDocument {
	const next: SettingsDocument = { ...current };
	for (const key of ['sexColours', 'tracePalette', 'focusColours', 'isMotionReduced'] as const) {
		if (patch[key] === undefined) continue;
		if (patch[key] === null) delete next[key];
		else (next as Record<string, unknown>)[key] = patch[key];
	}
	return next;
}

/**
 * Cards, ink and spheres must stay legible whatever colour is chosen. These are the floors WCAG
 * asks for at the sizes the views draw them: a card border against its fill, the card's ink on its
 * fill, and each sphere or star against both dark stages.
 */
export const CARD_BORDER_FLOOR = 3;
export const INK_FLOOR = 4.5;
export const SPHERE_FLOOR = 3;
const INK = '#1c1917';
const DARK_STAGES = ['#10141f', '#090d1b'] as const;
const SEX_LABELS = { male: 'Male', female: 'Female', unknown: 'Other or unknown' } as const;

/**
 * Refuses a palette that breaks a floor, naming the sex and the colour that does. Checked against
 * the palette the document resolves to, so a derived shade is held to the same floor as the base.
 */
export function assertContrastFloors(document: SettingsDocument): void {
	if (document.sexColours === undefined) return;
	const palette = resolvePalette(document);
	for (const key of ['male', 'female', 'unknown'] as const) {
		const shades = palette.sex[key];
		const label = SEX_LABELS[key];
		if (contrastRatio(shades.border, shades.fill) < CARD_BORDER_FLOOR)
			throw new ValidationError(
				`${label}: the card border is too close to its fill (needs ${CARD_BORDER_FLOOR}:1). Choose a darker or more saturated colour.`
			);
		if (contrastRatio(INK, shades.fill) < INK_FLOOR)
			throw new ValidationError(
				`${label}: the card text does not read on its fill (needs ${INK_FLOOR}:1). Choose a paler colour.`
			);
		for (const stage of DARK_STAGES)
			for (const colour of [shades.sphere, shades.star])
				if (contrastRatio(colour, stage) < SPHERE_FLOOR)
					throw new ValidationError(
						`${label}: the sphere is too dark to show on the 3D stage (needs ${SPHERE_FLOOR}:1). Choose a lighter colour.`
					);
	}
}
