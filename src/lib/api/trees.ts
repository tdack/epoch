import type { TreeSummary } from '#lib/types/genealogy.js';
import type { FocusGraphDto, TreeSummaryDto, WholeTreeGraphDto } from '#lib/shared/graph-views.js';
import type { TreeRole } from '#lib/shared/roles.js';
import { call, enc, json } from './client.js';

export async function createTreeApi(payload: {
	name: string;
	description?: string;
}): Promise<{ id: string; name: string }> {
	const data = await call<{ tree: { id: string; name: string } }>(
		'/api/trees',
		json('POST', payload),
		'Failed to create tree'
	);
	return data.tree;
}

/** Rename the tree and set its address (ADR-045); a null slug leaves it reached by its id. */
export async function renameTreeApi(
	treeId: string,
	name: string,
	slug: string | null,
	version: number
): Promise<{ id: string; slug: string | null }> {
	return call<{ tree: { id: string; slug: string | null } }>(
		`/api/trees/${enc(treeId)}`,
		json('PATCH', { name, slug, version }),
		'Failed to rename tree'
	).then((d) => d.tree);
}

/** One row of the install owner's Trees page (`GET /api/admin/trees`). */
export interface InstallTree {
	id: string;
	slug: string | null;
	name: string;
	version: number;
	/** The caller's role in the tree; null when they are not a member. */
	role: TreeRole | null;
	ownerNames: string[];
	peopleCount: number;
	memberCount: number;
	isPublic: boolean;
	publicSince: string | null;
}

export function fetchInstallTrees(fetchFn: typeof fetch = fetch): Promise<InstallTree[]> {
	return call<{ trees: InstallTree[] }>(
		'/api/admin/trees',
		undefined,
		'Failed to load trees',
		fetchFn
	).then((d) => d.trees);
}

/** Makes `treeId` the public tree, or none for null. The name is the typed confirmation, re-checked by the server. */
export async function setPublicTreeApi(treeId: string | null, confirmName: string): Promise<void> {
	await call(
		'/api/admin/public-tree',
		json('PUT', { treeId, confirmName }),
		'Failed to change the public tree'
	);
}

export async function deleteTreeApi(treeId: string): Promise<void> {
	await call(`/api/trees/${treeId}`, { method: 'DELETE' }, 'Failed to delete tree');
}

export interface TreeImpact {
	people: number;
	unions: number;
	links: number;
	events: number;
	media: number;
}

export async function previewTreeDeletionApi(treeId: string): Promise<TreeImpact> {
	const data = await call<{ treeImpact: TreeImpact }>(
		`/api/trees/${treeId}/impact`,
		json('POST', { kind: 'delete_tree' }),
		'Failed to preview the impact'
	);
	return data.treeImpact;
}

export interface FocusGraphQuery {
	up?: number;
	down?: number;
	shouldIncludeSiblings?: boolean;
	shouldIncludeStepFamilies?: boolean;
	/** Steps off the direct line to fetch, 0 to 2 (`side`). */
	collateralDepth?: number;
	/** Fetch the focus person's partners' parents and siblings (`origins`). */
	shouldIncludePartnerOrigins?: boolean;
	/** Opened stubs as URL tokens. */
	exp?: string[];
}

export function fetchFocusGraph(
	treeId: string,
	focusId: string,
	query: FocusGraphQuery,
	fetchFn: typeof fetch = fetch
): Promise<FocusGraphDto> {
	const params = new URLSearchParams({ focus: focusId });
	if (query.up !== undefined) params.set('up', String(query.up));
	if (query.down !== undefined) params.set('down', String(query.down));
	if (query.shouldIncludeSiblings !== undefined)
		params.set('siblings', query.shouldIncludeSiblings ? '1' : '0');
	if (query.shouldIncludeStepFamilies !== undefined)
		params.set('step', query.shouldIncludeStepFamilies ? '1' : '0');
	if (query.collateralDepth !== undefined) params.set('side', String(query.collateralDepth));
	if (query.shouldIncludePartnerOrigins !== undefined)
		params.set('origins', query.shouldIncludePartnerOrigins ? '1' : '0');
	if (query.exp?.length) params.set('exp', query.exp.join(','));
	return call(
		`/api/trees/${enc(treeId)}/graph?${params}`,
		undefined,
		'Failed to load the tree',
		fetchFn
	);
}

/** Everyone the viewer may see, capped, with no focus (`scope=all`). */
export function fetchWholeTreeGraph(
	treeId: string,
	fetchFn: typeof fetch = fetch
): Promise<WholeTreeGraphDto> {
	return call(
		`/api/trees/${enc(treeId)}/graph?scope=all`,
		undefined,
		'Failed to load the tree',
		fetchFn
	);
}

export function fetchTreeSummary(
	treeId: string,
	fetchFn: typeof fetch = fetch
): Promise<TreeSummaryDto> {
	return call(`/api/trees/${enc(treeId)}/summary`, undefined, 'Failed to load the tree', fetchFn);
}

export function fetchTreeList(fetchFn: typeof fetch = fetch): Promise<TreeSummary[]> {
	return call<{ trees?: TreeSummary[] }>(
		'/api/trees',
		undefined,
		'Failed to load trees',
		fetchFn
	).then((d) => d.trees || []);
}
