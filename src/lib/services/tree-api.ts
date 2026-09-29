import type {
	TreeSummary,
	TreeDetails,
	PersonFormData,
	RelationshipIntent,
	RelationshipPlan,
	RelationshipGraph,
	PeopleSearchResult,
	ParentChildType,
	ChangeSummary,
	ImpactSummary,
	UnionEventInput
} from '#lib/types/genealogy.js';
import type { MergeChoices, MergeConflict } from '#lib/shared/union-merge.js';

/** A failed API call, with the server's code and details so callers can react to specific cases. */
export class ApiError extends Error {
	constructor(
		message: string,
		readonly status: number,
		readonly code: string | undefined,
		readonly details: Record<string, unknown> | undefined
	) {
		super(message);
		this.name = 'ApiError';
	}
}

/** The record changed since it was loaded (HTTP 409, STALE_VERSION); `current` is what is stored now. */
export class ConflictError extends ApiError {
	constructor(
		message: string,
		status: number,
		code: string | undefined,
		readonly details: {
			reason: 'STALE_VERSION';
			entity: 'individual' | 'union';
			id: string;
			expectedVersion: number;
			currentVersion: number;
			current: Record<string, any>;
		}
	) {
		super(message, status, code, details);
		this.name = 'ConflictError';
	}
}

export function isConflict(error: unknown): error is ConflictError {
	return error instanceof ConflictError;
}

async function call<T>(url: string, init: RequestInit | undefined, failure: string): Promise<T> {
	const res = await fetch(url, init);
	const data = (await res.json().catch(() => ({}))) as Record<string, any>;
	if (!res.ok) {
		const message = data.error || failure;
		// Only a conflict that carries the stored values can be shown as a comparison; a bare
		// CONCURRENT_WRITE (a race inside the save) is reported as a plain error.
		if (res.status === 409 && data.details?.reason === 'STALE_VERSION' && data.details.current) {
			throw new ConflictError(message, res.status, data.code, data.details);
		}
		throw new ApiError(message, res.status, data.code, data.details);
	}
	return data as T;
}

const json = (method: string, body: unknown): RequestInit => ({
	method,
	headers: { 'Content-Type': 'application/json' },
	body: JSON.stringify(body)
});

export async function fetchTrees(): Promise<TreeSummary[]> {
	const data = await call<{ trees?: TreeSummary[] }>('/api/trees', undefined, 'Failed to load trees');
	return data.trees || [];
}

export async function fetchTreeDetails(treeId: string): Promise<TreeDetails> {
	return call<TreeDetails>(`/api/trees/${treeId}`, undefined, 'Failed to fetch tree details');
}

export async function createTreeApi(payload: { name: string; description?: string }): Promise<{ id: string; name: string }> {
	const data = await call<{ tree: { id: string; name: string } }>('/api/trees', json('POST', payload), 'Failed to create tree');
	return data.tree;
}

export async function deleteTreeApi(treeId: string): Promise<void> {
	await call(`/api/trees/${treeId}`, { method: 'DELETE' }, 'Failed to delete tree');
}

export async function createIndividualApi(
	treeId: string,
	data: PersonFormData
): Promise<{ id: string; change: ChangeSummary | null }> {
	const res = await call<{ individual: { id: string }; change: ChangeSummary | null }>(
		`/api/trees/${treeId}/individuals`,
		json('POST', data),
		'Failed to add individual.'
	);
	return { id: res.individual.id, change: res.change };
}

/** `version` is the person's version when the form was opened; a newer stored version is a conflict. */
export async function updateIndividualApi(
	treeId: string,
	individualId: string,
	data: Partial<PersonFormData>,
	version: number
): Promise<{ change: ChangeSummary | null }> {
	const res = await call<{ change: ChangeSummary | null }>(
		`/api/trees/${treeId}/individuals/${individualId}`,
		json('PUT', { ...data, version }),
		'Failed to update person.'
	);
	return { change: res.change };
}

export async function deleteIndividualApi(
	treeId: string,
	individualId: string,
	version: number | undefined
): Promise<{ change: ChangeSummary | null }> {
	const query = version === undefined ? '' : `?version=${version}`;
	const res = await call<{ change: ChangeSummary | null }>(
		`/api/trees/${treeId}/individuals/${individualId}${query}`,
		{ method: 'DELETE' },
		'Failed to delete person'
	);
	return { change: res.change };
}

export async function previewGedcomImport(file: File, treeId?: string | null): Promise<import('#lib/types/genealogy.js').ImportPreviewData> {
	if (treeId) {
		const fd = new FormData();
		fd.append('file', file);
		fd.append('treeId', treeId);
		return call('/api/import', { method: 'PUT', body: fd }, 'Failed to preview import');
	}

	return {
		mode: 'replace',
		incoming: { individuals: 0, families: 0, events: 0 }
	};
}

export async function submitGedcomImport(
	file: File,
	mode: 'replace' | 'merge',
	treeId?: string | null
): Promise<{ individualsCount?: number; familiesCount?: number; treeId?: string }> {
	const fd = new FormData();
	fd.append('file', file);
	fd.append('mode', mode);
	if (treeId) {
		fd.append('treeId', treeId);
	}
	return call('/api/import', { method: 'POST', body: fd }, 'Import failed');
}

/** Preview an intent: the sentence, warnings and the exact records a save would write. Saves nothing. */
export async function planRelationshipApi(treeId: string, intent: RelationshipIntent): Promise<RelationshipPlan> {
	const data = await call<{ plan: RelationshipPlan }>(
		`/api/trees/${treeId}/relationships/plan`,
		json('POST', { intent }),
		'Failed to preview relationship'
	);
	return data.plan;
}

export async function applyRelationshipApi(
	treeId: string,
	intent: RelationshipIntent
): Promise<{ plan: RelationshipPlan; change: ChangeSummary | null }> {
	return call(`/api/trees/${treeId}/relationships`, json('POST', { intent }), 'Failed to apply relationship');
}

export type RelationshipDeleteCommand =
	| { kind: 'remove_parent_child'; parentId: string; childId: string; type: ParentChildType }
	| { kind: 'remove_partner_from_union'; unionId: string; personId: string; expectedVersion?: number }
	| { kind: 'destroy_union'; unionId: string; expectedVersion?: number };

export async function removeRelationshipApi(
	treeId: string,
	command: RelationshipDeleteCommand
): Promise<{ change: ChangeSummary | null }> {
	const res = await call<{ change: ChangeSummary | null }>(
		`/api/trees/${treeId}/relationships/remove`,
		json('POST', command),
		'Failed to remove relationship'
	);
	return { change: res.change };
}

export type ImpactRequest = RelationshipDeleteCommand | { kind: 'delete_person'; personId: string };

/** What a destructive action would delete or change, listed exactly. Saves nothing. */
export async function previewImpactApi(treeId: string, request: ImpactRequest): Promise<ImpactSummary> {
	const data = await call<{ impact: ImpactSummary }>(`/api/trees/${treeId}/impact`, json('POST', request), 'Failed to preview the impact');
	return data.impact;
}

export interface TreeImpact {
	people: number;
	unions: number;
	links: number;
	events: number;
	media: number;
}

export async function previewTreeDeletionApi(treeId: string): Promise<TreeImpact> {
	const data = await call<{ treeImpact: TreeImpact }>(`/api/trees/${treeId}/impact`, json('POST', { kind: 'delete_tree' }), 'Failed to preview the impact');
	return data.treeImpact;
}

export async function updateUnionApi(
	treeId: string,
	unionId: string,
	payload: { version: number; status?: string; events?: UnionEventInput[] }
): Promise<{ change: ChangeSummary | null }> {
	const res = await call<{ change: ChangeSummary | null }>(
		`/api/trees/${treeId}/unions/${unionId}`,
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

export async function previewUnionMergeApi(treeId: string, request: MergeUnionsRequest): Promise<MergePreviewResponse> {
	return call(`/api/trees/${treeId}/unions/merge`, json('POST', { ...request, isPreview: true }), 'Failed to preview the merge');
}

export async function mergeUnionsApi(treeId: string, request: MergeUnionsRequest): Promise<{ change: ChangeSummary | null }> {
	const res = await call<{ change: ChangeSummary | null }>(`/api/trees/${treeId}/unions/merge`, json('POST', request), 'Failed to merge the partnerships');
	return { change: res.change };
}

/** Undo the signed-in user's most recent change. Refusals (a later change touched it) come back as ApiError. */
export async function undoApi(treeId: string): Promise<{ undone: { id: string; summary: string } }> {
	return call(`/api/trees/${treeId}/undo`, { method: 'POST' }, 'Failed to undo');
}

export async function fetchRelationshipGraph(treeId: string): Promise<RelationshipGraph> {
	const data = await call<{ graph: RelationshipGraph }>(`/api/trees/${treeId}/graph`, undefined, 'Failed to load relationship graph');
	return data.graph;
}

export async function searchPeopleApi(treeId: string, query: string): Promise<PeopleSearchResult[]> {
	const data = await call<{ people?: PeopleSearchResult[] }>(
		`/api/trees/${treeId}/people-search?q=${encodeURIComponent(query)}`,
		undefined,
		'Failed to search people'
	);
	return data.people || [];
}
