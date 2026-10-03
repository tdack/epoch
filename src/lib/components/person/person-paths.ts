/** Where a person's and a partnership's pages are; the sections link to them. */

const treePath = (treeId: string) => `/trees/${encodeURIComponent(treeId)}`;

export const personPath = (treeId: string, personId: string) =>
	`${treePath(treeId)}/people/${encodeURIComponent(personId)}`;

export const unionPath = (treeId: string, unionId: string) =>
	`${treePath(treeId)}/unions/${encodeURIComponent(unionId)}`;

export { treePath };
