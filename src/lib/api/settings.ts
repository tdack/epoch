import type { LayoutMode } from '#lib/shared/view-mode.js';
import type { SettingsPatch, SettingsView } from '#lib/shared/settings.js';
import { call, json, path } from './client.js';

/** The caller's own view in this tree; `null` clears it so the tree's default applies. */
export async function saveViewMode(treeId: string, mode: LayoutMode | null): Promise<void> {
	await call(
		path`/api/trees/${treeId}/view-mode`,
		json('PUT', { mode }),
		'Failed to save the view'
	);
}

/** The caller's own starting person in this tree; `null` clears it. */
export async function saveHomePerson(
	treeId: string,
	personId: string | null
): Promise<{ homePersonId: string | null; homePersonName: string | null }> {
	return call(
		path`/api/trees/${treeId}/home-person`,
		json('PUT', { personId }),
		'Failed to save the starting person'
	);
}

/** The tree `/` opens for the signed-in user; null clears it. */
export async function saveDefaultTree(treeId: string | null): Promise<void> {
	await call('/api/default-tree', json('PUT', { treeId }), 'Failed to save the default tree');
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
