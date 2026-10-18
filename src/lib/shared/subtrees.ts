/**
 * Sub-trees (docs/proposal-subtrees.md): a named lens on a tree, rooted at one person. The server
 * and the screens share these shapes.
 */

/** The longest name a sub-tree may have. */
export const MAX_SUBTREE_NAME_LENGTH = 120;

/** A sub-tree as the management API returns it. */
export interface SubtreeDto {
	id: string;
	slug: string;
	name: string;
	rootPersonId: string;
	position: number;
	version: number;
	/** The root person no longer exists (deleted, and an undo would bring them back). */
	isRootMissing: boolean;
}

/** A sub-tree as the tree summary lists it: enough to build the switcher. */
export interface SubtreeSummaryDto {
	id: string;
	slug: string;
	name: string;
	rootPersonId: string;
}

/** The sub-tree the address named, as the summary returns it: the banner shows its root by name. */
export interface ActiveSubtreeDto extends SubtreeSummaryDto {
	/** The root person's display name; null when the root no longer exists. */
	rootName: string | null;
}

export interface CreateSubtreeInput {
	name: string;
	slug: string;
	rootPersonId: string;
}

/** Fields to change; `version` is the one the caller last saw. */
export interface UpdateSubtreeInput {
	name?: string;
	slug?: string;
	rootPersonId?: string;
	position?: number;
	version?: number;
}
