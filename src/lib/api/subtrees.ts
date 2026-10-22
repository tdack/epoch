import type {
	CreateSubtreeInput,
	ReorderSubtreesInput,
	SubtreeDto,
	UpdateSubtreeInput
} from '#lib/shared/subtrees.js';
import type { Changed } from './client.js';
import { call, json, path } from './client.js';

export function createSubtree(
	treeId: string,
	input: CreateSubtreeInput
): Promise<Changed & { subtree: SubtreeDto }> {
	return call(
		path`/api/trees/${treeId}/subtrees`,
		json('POST', input),
		'Failed to add the sub-tree'
	);
}

export function updateSubtree(
	treeId: string,
	subtreeId: string,
	input: UpdateSubtreeInput
): Promise<Changed & { subtree: SubtreeDto }> {
	return call(
		path`/api/trees/${treeId}/subtrees/${subtreeId}`,
		json('PATCH', input),
		'Failed to save the sub-tree'
	);
}

/** Saves the whole list's order as one change. */
export function reorderSubtrees(treeId: string, input: ReorderSubtreesInput): Promise<Changed> {
	return call(
		path`/api/trees/${treeId}/subtrees`,
		json('PUT', input),
		'Failed to save the sub-tree order'
	);
}

export function deleteSubtree(
	treeId: string,
	subtreeId: string,
	version?: number
): Promise<Changed> {
	return call(
		path`/api/trees/${treeId}/subtrees/${subtreeId}` +
			(version === undefined ? '' : `?version=${version}`),
		{ method: 'DELETE' },
		'Failed to delete the sub-tree'
	);
}
