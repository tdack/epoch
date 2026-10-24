/**
 * The JSON bodies the client reads from `/api/**`. The route handler annotates its callback with
 * the same interface the client passes to `call<…>`, so a field renamed on one side fails the
 * typecheck on the other. Types only: the client still trusts the bytes that arrive.
 */

import type {
	ChangeSummary,
	ImpactSummary,
	PeopleSearchResult,
	RelationshipPlan
} from '#lib/types/genealogy.js';
import type { MergeConflict } from './union-merge.js';
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
	/** Also served at `<slug>.<zone>` (ADR-057). */
	isOnSubdomain: boolean;
}

/** `POST /api/trees` */
export interface CreateTreeResponse {
	tree: { id: string; name: string };
}

/** `PATCH /api/trees/[id]` */
export interface RenameTreeResponse {
	tree: { id: string; slug: string | null; isOnSubdomain: boolean };
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

/** `POST /api/trees/[id]/facts`: one fact copied onto each person in one change. */
export interface GroupFactResponse extends ChangeResponse {
	factIds: string[];
}

/** `POST /api/trees/[id]/citations/people`: people who already cited the source are skipped. */
export interface CitePeopleResponse extends ChangeResponse {
	skippedPersonIds: string[];
	/** With a `factType`: people who have no fact of that type, so nothing was cited for them. */
	missingFactPersonIds: string[];
}

/** A write that logs a change; `change` is null when the request changed nothing. */
export interface ChangeResponse {
	change: ChangeSummary | null;
}

/** `POST /api/files/[id]/links` and `DELETE /api/files/[id]/links/[entityId]` */
export type FileLinkResponse = ChangeResponse;

/** `POST /api/trees/[id]/people` and `PUT /api/trees/[id]/people/[personId]` */
export interface PersonWriteResponse extends ChangeResponse {
	individual: { id: string };
}

/** `GET /api/trees/[id]/people-search` */
export interface PeopleSearchResponse {
	people: PeopleSearchResult[];
}

/** `POST /api/trees/[id]/relationships/plan` */
export interface PlanRelationshipResponse {
	plan: RelationshipPlan;
}

/** `POST /api/trees/[id]/relationships`: 201 when it wrote something, 200 when a warning stopped it. */
export interface ApplyRelationshipResponse extends PlanRelationshipResponse, ChangeResponse {
	/** Every record written. The client does not read it. */
	affected: readonly unknown[];
}

/** `POST /api/trees/[id]/unions/merge` with `isPreview`: what a merge would do. `impact` is null while a conflict has no choice. */
export interface MergePreviewResponse {
	conflicts: MergeConflict[];
	impact: ImpactSummary | null;
}

/** `POST /api/trees/[id]/undo` */
export interface UndoResponse extends ChangeResponse {
	/** The change that was reverted. */
	undone: { id: string; summary: string };
}

/**
 * The body of every failed `/api` response. `code` is always present so a client can branch on it;
 * `details` appears only when the error has something to act on (the current version on a 409).
 */
export interface ApiErrorBody {
	error: string;
	code: string;
	details?: Record<string, unknown>;
}
