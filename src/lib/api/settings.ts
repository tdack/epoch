import type { LayoutMode } from '#lib/shared/view-mode.js';
import type { SettingsPatch, SettingsView } from '#lib/shared/settings.js';
import { call, enc, json } from './client.js';

/** The caller's own view in this tree; `null` clears it so the tree's default applies. */
export async function saveViewMode(treeId: string, mode: LayoutMode | null): Promise<void> {
	await call(
		`/api/trees/${enc(treeId)}/view-mode`,
		json('PUT', { mode }),
		'Failed to save the view'
	);
}

/** The tree `/` opens for the signed-in user; null clears it. */
export async function saveDefaultTree(treeId: string | null): Promise<void> {
	await call('/api/default-tree', json('PUT', { treeId }), 'Failed to save the default tree');
}

/** The view members with no choice of their own get; the owner's to set. */
export async function saveDefaultViewMode(treeId: string, mode: LayoutMode | null): Promise<void> {
	await call(
		`/api/trees/${enc(treeId)}/default-view`,
		json('PUT', { mode }),
		'Failed to save the default view'
	);
}

/** The caller's own colour layer, the site default and what they resolve to (ADR-054). */
export function fetchSettings(fetchFn: typeof fetch = fetch): Promise<SettingsView> {
	return call('/api/settings', undefined, 'Failed to load settings', fetchFn);
}

/** Changes the caller's own layer; a group sent as null inherits the site default again. */
export function saveMySettings(patch: SettingsPatch): Promise<SettingsView> {
	return call('/api/settings', json('PUT', patch), 'Failed to save your settings');
}

/** Changes the install-wide default; the install owner alone may. */
export function saveSiteSettings(
	patch: Omit<SettingsPatch, 'isMotionReduced'>
): Promise<SettingsView> {
	return call('/api/admin/settings', json('PUT', patch), 'Failed to save the site default');
}
