/**
 * The colour and motion choices a person or the install owner makes (ADR-054), with the two
 * business rules that guard them: a patch replaces or clears whole groups, and a palette must keep
 * its cards, ink and spheres legible. No storage or request handling in here.
 */

import { resolvePalette } from '#lib/shared/palette.js';
import { floorBreaches, type SettingsDocument, type SettingsPatch } from '#lib/shared/settings.js';
import { ValidationError } from './errors';

/** Applies a patch to a stored document. Pure: the caller decides what to persist. */
export function applyPatch(current: SettingsDocument, patch: SettingsPatch): SettingsDocument {
	const next: SettingsDocument = { ...current };
	for (const key of ['sexColours', 'tracePalette', 'focusColours', 'isMotionReduced', 'maps'] as const) {
		if (patch[key] === undefined) continue;
		if (patch[key] === null) delete next[key];
		else (next as Record<string, unknown>)[key] = patch[key];
	}
	return next;
}

/**
 * Refuses a palette that breaks a floor, naming the sex and the colour that does. Checked against
 * the palette the document resolves to, so a derived shade is held to the same floor as the base.
 */
export function assertContrastFloors(document: SettingsDocument): void {
	if (document.sexColours === undefined) return;
	const [breach] = floorBreaches(resolvePalette(document));
	if (breach) throw new ValidationError(breach.message);
}
