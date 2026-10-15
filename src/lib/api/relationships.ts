import type {
	RelationshipIntent,
	RelationshipPlan,
	ChangeSummary,
	ImpactSummary,
	UnionEventInput
} from '#lib/types/genealogy.js';
import type { ParentChildType } from '#lib/shared/relationship-model.js';
import type { MergeChoices, MergeConflict } from '#lib/shared/union-merge.js';
import type { UnionPageDto } from '#lib/shared/union-page.js';
import { call, json, path } from './client.js';

/** Preview an intent: the sentence, warnings and the exact records a save would write. Saves nothing. */
export async function planRelationshipApi(
	treeId: string,
	intent: RelationshipIntent
): Promise<RelationshipPlan> {
	const data = await call<{ plan: RelationshipPlan }>(
		path`/api/trees/${treeId}/relationships/plan`,
		json('POST', { intent }),
		'Failed to preview relationship'
	);
	return data.plan;
}

export async function applyRelationshipApi(
	treeId: string,
	intent: RelationshipIntent
): Promise<{ plan: RelationshipPlan; change: ChangeSummary | null }> {
	return call(
		path`/api/trees/${treeId}/relationships`,
		json('POST', { intent }),
		'Failed to apply relationship'
	);
}

export type RelationshipDeleteCommand =
	| { kind: 'remove_parent_child'; parentId: string; childId: string; type: ParentChildType }
	| {
			kind: 'remove_partner_from_union';
			unionId: string;
			personId: string;
			expectedVersion?: number;
	  }
	| { kind: 'destroy_union'; unionId: string; expectedVersion?: number };

export async function removeRelationshipApi(
	treeId: string,
	command: RelationshipDeleteCommand
): Promise<{ change: ChangeSummary | null }> {
	const res = await call<{ change: ChangeSummary | null }>(
		path`/api/trees/${treeId}/relationships/remove`,
		json('POST', command),
		'Failed to remove relationship'
	);
	return { change: res.change };
}

export type ImpactRequest = RelationshipDeleteCommand | { kind: 'delete_person'; personId: string };

/** What a destructive action would delete or change, listed exactly. Saves nothing. */
export async function previewImpactApi(
	treeId: string,
	request: ImpactRequest
): Promise<ImpactSummary> {
	const data = await call<{ impact: ImpactSummary }>(
		path`/api/trees/${treeId}/impact`,
		json('POST', request),
		'Failed to preview the impact'
	);
	return data.impact;
}

export async function updateUnionApi(
	treeId: string,
	unionId: string,
	payload: { version: number; status?: string; events?: UnionEventInput[] }
): Promise<{ change: ChangeSummary | null }> {
	const res = await call<{ change: ChangeSummary | null }>(
		path`/api/trees/${treeId}/unions/${unionId}`,
		json('PUT', payload),
		'Failed to save the partnership'
	);
	return { change: res.change };
}

export interface MergeUnionsRequest {
	survivorId: string;
	mergedIds: string[];
	expectedVersions: Record<string, number>;
	/** Which union's value to keep wherever the unions disagree: `status`, and per event type. */
	keep?: MergeChoices;
}

/** What a merge would do. `impact` is null while a conflict has no choice. */
export interface MergePreviewResponse {
	conflicts: MergeConflict[];
	impact: ImpactSummary | null;
}

export async function previewUnionMergeApi(
	treeId: string,
	request: MergeUnionsRequest
): Promise<MergePreviewResponse> {
	return call(
		path`/api/trees/${treeId}/unions/merge`,
		json('POST', { ...request, isPreview: true }),
		'Failed to preview the merge'
	);
}

export async function mergeUnionsApi(
	treeId: string,
	request: MergeUnionsRequest
): Promise<{ change: ChangeSummary | null }> {
	const res = await call<{ change: ChangeSummary | null }>(
		path`/api/trees/${treeId}/unions/merge`,
		json('POST', request),
		'Failed to merge the partnerships'
	);
	return { change: res.change };
}

/** Undo the signed-in user's most recent change. Refusals (a later change touched it) come back as ApiError. */
export async function undoApi(
	treeId: string
): Promise<{ undone: { id: string; summary: string } }> {
	return call(path`/api/trees/${treeId}/undo`, { method: 'POST' }, 'Failed to undo');
}

export function fetchUnionPage(
	treeId: string,
	unionId: string,
	fetchFn: typeof fetch = fetch
): Promise<UnionPageDto> {
	return call(
		path`/api/trees/${treeId}/unions/${unionId}`,
		undefined,
		'Failed to load the partnership',
		fetchFn
	);
}
