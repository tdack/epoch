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
import type { FocusGraphDto, TreeSummaryDto } from '#lib/server/services/graph-query-service.js';
import type { PersonPageDto } from '#lib/server/services/person-page-service.js';
import type { UnionPageDto } from '#lib/server/services/union-page-service.js';
import type { FactInput } from '#lib/shared/fact-types.js';
import type { NameInput } from '#lib/shared/name-types.js';
import type { SearchResponse } from '#lib/shared/search.js';
import type { MarksDto } from '#lib/shared/marks.js';
import type { PersonPrivacy } from '#lib/shared/privacy.js';
import type { PrivacySettingsDto } from '#lib/server/services/privacy-service.js';
import type { InvitationDto, MemberDto, MembersDto } from '#lib/server/services/member-service.js';
import type { TreeRole } from '#lib/shared/roles.js';
import type { RelationshipDto } from '#lib/shared/kinship.js';
import type { DescendantsDto, PedigreeDto } from '#lib/shared/charts.js';
import type { QualityReport } from '#lib/shared/quality.js';
import { MAX_PLACE_SUGGESTIONS, type PlaceDto, type PlaceListItem } from '#lib/shared/places.js';
import type { IndividualListItem, Page, SurnameListItem, UnionListItem } from '#lib/shared/lists.js';

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
			entity: 'individual' | 'union' | 'fact';
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

async function call<T>(url: string, init: RequestInit | undefined, failure: string, fetchFn: typeof fetch = fetch): Promise<T> {
	const res = await fetchFn(url, init);
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
	// Without a tree the server still analyses the file, so the duplicate families are listed for a new tree too.
	const fd = new FormData();
	fd.append('file', file);
	if (treeId) fd.append('treeId', treeId);
	return call('/api/import', { method: 'PUT', body: fd }, 'Failed to preview import');
}

export async function submitGedcomImport(
	file: File,
	mode: 'replace' | 'merge',
	treeId?: string | null,
	options: { shouldMergeDuplicateFamilies?: boolean } = {}
): Promise<{ individualsCount?: number; familiesCount?: number; mergedFamiliesCount?: number; treeId?: string }> {
	const fd = new FormData();
	fd.append('file', file);
	fd.append('mode', mode);
	if (treeId) {
		fd.append('treeId', treeId);
	}
	if (options.shouldMergeDuplicateFamilies) fd.append('mergeDuplicates', 'true');
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

/** The search page's results for its own URL parameters (`q`, `place`, `from`, `to`, `offset`). */
export function searchTreeApi(treeId: string, params: URLSearchParams, fetchFn: typeof fetch = fetch): Promise<SearchResponse> {
	return call(`/api/trees/${treeId}/search?${params}`, undefined, 'Failed to search the tree', fetchFn);
}

/** One page of a list, for the list page's own URL parameters. */
export function fetchList<T extends IndividualListItem | UnionListItem | SurnameListItem>(
	treeId: string,
	list: 'individuals' | 'unions' | 'surnames',
	params: URLSearchParams,
	fetchFn: typeof fetch = fetch
): Promise<Page<T>> {
	return call(`/api/trees/${treeId}/lists/${list}?${params}`, undefined, 'Failed to load the list', fetchFn);
}

export function fetchMarks(treeId: string, fetchFn: typeof fetch = fetch): Promise<MarksDto> {
	return call(`/api/trees/${treeId}/marks`, undefined, 'Failed to load favourites and recents', fetchFn);
}

/** Record a visit; answers with the user's marks as they now stand. */
export function recordRecentApi(treeId: string, personId: string): Promise<MarksDto> {
	return call(`/api/trees/${treeId}/marks/recents`, json('POST', { personId }), 'Failed to record the visit');
}

export function setFavoriteApi(treeId: string, personId: string, isFavorite: boolean): Promise<MarksDto> {
	return call(`/api/trees/${treeId}/marks/favorites/${encodeURIComponent(personId)}`, { method: isFavorite ? 'PUT' : 'DELETE' }, 'Failed to change the favourite');
}

// ---- Bounded reads (Phase 3) ----
// These take the `fetch` a SvelteKit load function hands them, so a server render forwards the
// caller's identity and the browser reuses the response.

const enc = encodeURIComponent;

export interface FocusGraphQuery {
	up?: number;
	down?: number;
	siblings?: boolean;
	step?: boolean;
	/** Opened stubs as URL tokens. */
	exp?: string[];
}

export function fetchFocusGraph(treeId: string, focusId: string, query: FocusGraphQuery, fetchFn: typeof fetch = fetch): Promise<FocusGraphDto> {
	const params = new URLSearchParams({ focus: focusId });
	if (query.up !== undefined) params.set('up', String(query.up));
	if (query.down !== undefined) params.set('down', String(query.down));
	if (query.siblings !== undefined) params.set('siblings', query.siblings ? '1' : '0');
	if (query.step !== undefined) params.set('step', query.step ? '1' : '0');
	if (query.exp?.length) params.set('exp', query.exp.join(','));
	return call(`/api/trees/${enc(treeId)}/graph?${params}`, undefined, 'Failed to load the tree', fetchFn);
}

export function fetchTreeSummary(treeId: string, fetchFn: typeof fetch = fetch): Promise<TreeSummaryDto> {
	return call(`/api/trees/${enc(treeId)}/summary`, undefined, 'Failed to load the tree', fetchFn);
}

export function fetchTreeList(fetchFn: typeof fetch = fetch): Promise<TreeSummary[]> {
	return call<{ trees?: TreeSummary[] }>('/api/trees', undefined, 'Failed to load trees', fetchFn).then((d) => d.trees || []);
}

export function fetchPersonPage(treeId: string, personId: string, fetchFn: typeof fetch = fetch): Promise<PersonPageDto> {
	return call(`/api/trees/${enc(treeId)}/people/${enc(personId)}`, undefined, 'Failed to load the person', fetchFn);
}

export function fetchUnionPage(treeId: string, unionId: string, fetchFn: typeof fetch = fetch): Promise<UnionPageDto> {
	return call(`/api/trees/${enc(treeId)}/unions/${enc(unionId)}`, undefined, 'Failed to load the partnership', fetchFn);
}

// ---- Facts ----

export async function createFactApi(treeId: string, personId: string, fact: FactInput): Promise<{ factId: string; change: ChangeSummary | null }> {
	return call(`/api/trees/${enc(treeId)}/people/${enc(personId)}/facts`, json('POST', fact), 'Failed to add the fact');
}

export async function updateFactApi(treeId: string, factId: string, fact: Partial<FactInput>, version: number): Promise<{ change: ChangeSummary | null }> {
	return call(`/api/trees/${enc(treeId)}/facts/${enc(factId)}`, json('PUT', { ...fact, version }), 'Failed to save the fact');
}

export async function deleteFactApi(treeId: string, factId: string, version: number): Promise<{ change: ChangeSummary | null }> {
	return call(`/api/trees/${enc(treeId)}/facts/${enc(factId)}?version=${version}`, { method: 'DELETE' }, 'Failed to remove the fact');
}

export async function reorderFactsApi(treeId: string, personId: string, orderedFactIds: string[]): Promise<{ change: ChangeSummary | null }> {
	return call(`/api/trees/${enc(treeId)}/people/${enc(personId)}/facts/reorder`, json('POST', { orderedFactIds }), 'Failed to reorder the facts');
}

export type FactImpactRequest =
	| { kind: 'create_fact'; personId: string; fact: FactInput }
	| { kind: 'update_fact'; factId: string; version?: number; fact: Partial<FactInput> }
	| { kind: 'delete_fact'; factId: string; version?: number };

export async function previewFactApi(treeId: string, request: FactImpactRequest): Promise<ImpactSummary> {
	const data = await call<{ impact: ImpactSummary }>(`/api/trees/${enc(treeId)}/facts/impact`, json('POST', request), 'Failed to preview the change');
	return data.impact;
}

// ---- Names ----

export async function createNameApi(treeId: string, personId: string, name: NameInput, isPreferred = false): Promise<{ nameId: string; change: ChangeSummary | null }> {
	return call(`/api/trees/${enc(treeId)}/people/${enc(personId)}/names`, json('POST', { ...name, isPreferred }), 'Failed to add the name');
}

export async function updateNameApi(treeId: string, nameId: string, name: Partial<NameInput>, version: number): Promise<{ change: ChangeSummary | null }> {
	return call(`/api/trees/${enc(treeId)}/names/${enc(nameId)}`, json('PUT', { ...name, version }), 'Failed to save the name');
}

export async function deleteNameApi(treeId: string, nameId: string, version: number): Promise<{ change: ChangeSummary | null }> {
	return call(`/api/trees/${enc(treeId)}/names/${enc(nameId)}?version=${version}`, { method: 'DELETE' }, 'Failed to remove the name');
}

export async function reorderNamesApi(treeId: string, personId: string, orderedNameIds: string[]): Promise<{ change: ChangeSummary | null }> {
	return call(`/api/trees/${enc(treeId)}/people/${enc(personId)}/names/reorder`, json('POST', { orderedNameIds }), 'Failed to reorder the names');
}

export async function setPreferredNameApi(treeId: string, personId: string, nameId: string, version?: number): Promise<{ change: ChangeSummary | null }> {
	return call(`/api/trees/${enc(treeId)}/people/${enc(personId)}/names/preferred`, json('POST', { nameId, version }), 'Failed to choose the preferred name');
}

/** Force a person public or private, or let their dates decide (`auto`). A manager's action. */
export async function setPersonPrivacyApi(treeId: string, personId: string, privacy: PersonPrivacy, version?: number): Promise<{ change: ChangeSummary | null }> {
	return call(`/api/trees/${enc(treeId)}/people/${enc(personId)}/privacy`, json('PUT', { privacy, version }), 'Failed to change the privacy of the person');
}

export async function fetchPrivacySettings(treeId: string, fetcher: typeof fetch = fetch): Promise<PrivacySettingsDto> {
	return call(`/api/trees/${enc(treeId)}/privacy`, { method: 'GET' }, 'Failed to load the privacy settings', fetcher);
}

export async function savePrivacySettings(treeId: string, patch: Partial<PrivacySettingsDto>): Promise<PrivacySettingsDto> {
	return call(`/api/trees/${enc(treeId)}/privacy`, json('PUT', patch), 'Failed to save the privacy settings');
}

export type { InvitationDto, MemberDto, MembersDto };

export async function fetchMembers(treeId: string, fetcher: typeof fetch = fetch): Promise<MembersDto> {
	return call(`/api/trees/${enc(treeId)}/members`, { method: 'GET' }, 'Failed to load the members', fetcher);
}

export async function inviteMemberApi(treeId: string, email: string, role: TreeRole): Promise<InvitationDto> {
	return call(`/api/trees/${enc(treeId)}/invitations`, json('POST', { email, role }), 'Failed to send the invitation');
}

export async function withdrawInvitationApi(treeId: string, invitationId: string): Promise<void> {
	await call(`/api/trees/${enc(treeId)}/invitations/${enc(invitationId)}`, { method: 'DELETE' }, 'Failed to withdraw the invitation');
}

export async function changeMemberRoleApi(treeId: string, userId: string, role: TreeRole, version: number): Promise<MemberDto> {
	return call(`/api/trees/${enc(treeId)}/members/${enc(userId)}`, json('PATCH', { role, version }), 'Failed to change the role');
}

export async function removeMemberApi(treeId: string, userId: string, version: number): Promise<void> {
	await call(`/api/trees/${enc(treeId)}/members/${enc(userId)}?version=${version}`, { method: 'DELETE' }, 'Failed to remove the member');
}

export async function fetchRelationship(treeId: string, fromId: string, toId: string, fetcher: typeof fetch = fetch): Promise<RelationshipDto> {
	return call(`/api/trees/${enc(treeId)}/relationship?from=${encodeURIComponent(fromId)}&to=${encodeURIComponent(toId)}`, { method: 'GET' }, 'Failed to work out the relationship', fetcher);
}

export async function fetchPedigree(treeId: string, personId: string, generations: number, fetcher: typeof fetch = fetch): Promise<PedigreeDto> {
	return call(`/api/trees/${enc(treeId)}/charts/pedigree?person=${encodeURIComponent(personId)}&generations=${generations}`, { method: 'GET' }, 'Failed to load the pedigree', fetcher);
}

export async function fetchDescendants(treeId: string, personId: string, generations: number, fetcher: typeof fetch = fetch): Promise<DescendantsDto> {
	return call(`/api/trees/${enc(treeId)}/charts/descendants?person=${encodeURIComponent(personId)}&generations=${generations}`, { method: 'GET' }, 'Failed to load the descendants', fetcher);
}

export async function fetchPlaces(treeId: string, params: URLSearchParams, fetcher: typeof fetch = fetch): Promise<Page<PlaceListItem>> {
	return call(`/api/trees/${enc(treeId)}/places?${params}`, { method: 'GET' }, 'Failed to list the places', fetcher);
}

export async function fetchPlace(treeId: string, name: string, params: URLSearchParams, fetcher: typeof fetch = fetch): Promise<PlaceDto> {
	const query = new URLSearchParams(params);
	query.set('name', name);
	return call(`/api/trees/${enc(treeId)}/places?${query}`, { method: 'GET' }, 'Failed to load the place', fetcher);
}

/** Places whose text contains `text`, for the fact editor's suggestions. */
export async function suggestPlacesApi(treeId: string, text: string): Promise<string[]> {
	const data = await fetchPlaces(treeId, new URLSearchParams({ q: text, limit: String(MAX_PLACE_SUGGESTIONS) }));
	return data.items.map((p) => p.name);
}

/** Rename a place, or merge it into the place that already has `name`; one change, one undo. */
export async function rewritePlaceApi(treeId: string, placeId: string, name: string): Promise<{ change: ChangeSummary | null; name: string }> {
	return call(`/api/trees/${enc(treeId)}/places/${enc(placeId)}`, json('PUT', { name }), 'Failed to change the place');
}

export async function previewPlaceRewriteApi(treeId: string, placeId: string, name: string): Promise<ImpactSummary> {
	const data = await call<{ impact: ImpactSummary }>(`/api/trees/${enc(treeId)}/places/${enc(placeId)}/impact`, json('POST', { name }), 'Failed to preview the change');
	return data.impact;
}

export async function fetchQuality(treeId: string, fetcher: typeof fetch = fetch): Promise<QualityReport> {
	return call(`/api/trees/${enc(treeId)}/quality`, { method: 'GET' }, 'Failed to load the report', fetcher);
}

export async function dismissFindingApi(treeId: string, key: string, reason: string): Promise<void> {
	await call(`/api/trees/${enc(treeId)}/quality`, json('PUT', { key, reason }), 'Failed to dismiss the finding');
}

export async function restoreFindingApi(treeId: string, key: string): Promise<void> {
	await call(`/api/trees/${enc(treeId)}/quality?key=${enc(key)}`, { method: 'DELETE' }, 'Failed to restore the finding');
}

export type NameImpactRequest =
	| { kind: 'create_name'; personId: string; name: NameInput & { isPreferred?: boolean } }
	| { kind: 'update_name'; nameId: string; version?: number; name: Partial<NameInput> }
	| { kind: 'delete_name'; nameId: string; version?: number }
	| { kind: 'set_preferred_name'; personId: string; nameId: string; version?: number };

export async function previewNameApi(treeId: string, request: NameImpactRequest): Promise<ImpactSummary> {
	const data = await call<{ impact: ImpactSummary }>(`/api/trees/${enc(treeId)}/names/impact`, json('POST', request), 'Failed to preview the change');
	return data.impact;
}
