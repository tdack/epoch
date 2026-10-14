/**
 * The tree a media object key belongs to. Kept apart from the service so the usage listing can
 * group objects by tree without importing the service that imports it.
 */

/**
 * Reads the tree from a key. Current keys are `media/<treeId>/<mediaId>.<ext>`; legacy keys are
 * `media/<treeId>/<entityId>/<file>` and keep working because existing objects are not moved. The
 * owner is never read from the key, so the shape only has to be a key this app wrote. Ids contain
 * no slash.
 */
export function parseMediaKey(key: string): { treeId: string } | null {
	const [prefix, treeId, ...rest] = key.split('/');
	if (prefix !== 'media' || !treeId || rest.length < 1 || rest.length > 2) return null;
	if (rest.some((segment) => segment === '')) return null;
	return { treeId };
}
