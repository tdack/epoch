/**
 * The JSON bodies the client reads from `/api/**`. The route handler annotates its callback with
 * the same interface the client passes to `call<…>`, so a field renamed on one side fails the
 * typecheck on the other. Types only: the client still trusts the bytes that arrive.
 */

import type { ChangeSummary, ImpactSummary, TreeSummary } from '#lib/types/genealogy.js';
import type { TreeRole } from './roles.js';

/** One row of the install owner's Trees page. */
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

/** `POST /api/trees` */
export interface CreateTreeResponse {
	tree: { id: string; name: string };
}

/** `PATCH /api/trees/[id]` */
export interface RenameTreeResponse {
	tree: { id: string; slug: string | null };
}

/** `GET /api/trees` */
export interface TreeListResponse {
	trees: TreeSummary[];
}

/** `GET /api/admin/trees` */
export interface InstallTreesResponse {
	trees: InstallTree[];
}

/** What deleting a tree would remove. */
export interface TreeImpact {
	people: number;
	unions: number;
	links: number;
	events: number;
	media: number;
}

/** `POST /api/trees/[id]/impact` with `kind: 'delete_tree'` */
export interface TreeImpactResponse {
	treeImpact: TreeImpact;
}

/** Every `…/impact` preview: the records a change would write, nothing saved. */
export interface ImpactResponse {
	impact: ImpactSummary;
}

/** A write that logs a change; `change` is null when the request changed nothing. */
export interface ChangeResponse {
	change: ChangeSummary | null;
}
