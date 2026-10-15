/**
 * The settings page's working copy of one colour layer. Each group is either the layer's own
 * colours or `null`, which inherits from the layers below; the API saves whole groups, so editing
 * one colour of an inherited group copies the inherited group first.
 */

import { resolvePalette, type Palette } from '#lib/components/tree/palette.js';
import type {
	ColourGroup,
	ColourPreset,
	SettingsDocument,
	SettingsPatch
} from '#lib/shared/settings.js';

type Groups = ColourPreset['groups'];
export type ColourDraft = { [K in ColourGroup]: Groups[K] | null };

export function draftFrom(layer: SettingsDocument): ColourDraft {
	return {
		sexColours: layer.sexColours ?? null,
		tracePalette: layer.tracePalette ?? null,
		focusColours: layer.focusColours ?? null
	};
}

function documentOf(draft: ColourDraft): SettingsDocument {
	const document: SettingsDocument = {};
	if (draft.sexColours) document.sexColours = draft.sexColours;
	if (draft.tracePalette) document.tracePalette = draft.tracePalette;
	if (draft.focusColours) document.focusColours = draft.focusColours;
	return document;
}

/** The palette the draft would paint with, over the layers it inherits from. */
export function draftPalette(draft: ColourDraft, below: readonly SettingsDocument[]): Palette {
	return resolvePalette(documentOf(draft), ...below);
}

/** The base colours a palette was resolved from, in the shape a layer stores. */
export function groupsOf(palette: Palette): Groups {
	return {
		sexColours: {
			male: palette.sex.male.border,
			female: palette.sex.female.border,
			unknown: palette.sex.unknown.border
		},
		tracePalette: { trace: [...palette.trace], intersection: palette.intersection },
		focusColours: { ...palette.focus }
	};
}

/** What saving the draft sends: each own group whole, each inherited group as null. */
export function patchFrom(draft: ColourDraft): SettingsPatch {
	return {
		sexColours: draft.sexColours,
		tracePalette: draft.tracePalette,
		focusColours: draft.focusColours
	};
}

/** Whether the draft differs from what the layer stores. */
export function isDraftChanged(draft: ColourDraft, layer: SettingsDocument): boolean {
	return JSON.stringify(patchFrom(draft)) !== JSON.stringify(patchFrom(draftFrom(layer)));
}
