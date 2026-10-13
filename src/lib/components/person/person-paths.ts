/** Where a person's and a partnership's pages are; the sections link to them. */

import { treePath, type TreeRef } from '#lib/shared/tree-slug.js';

export const personPath = (tree: TreeRef, personId: string) =>
	`${treePath(tree)}/people/${encodeURIComponent(personId)}`;

export const unionPath = (tree: TreeRef, unionId: string) =>
	`${treePath(tree)}/unions/${encodeURIComponent(unionId)}`;

export { treePath };
