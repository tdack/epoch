import { browser } from '$app/env';
import type {
	TreeSummary,
	PersonFormData,
	RelationshipIntent,
	RelationshipPlan,
	RelationshipGraph,
	PeopleSearchResult,
	ChangeSummary,
	ImpactSummary,
	UnionEventInput
} from '#lib/types/genealogy.js';
import type { ParentChildType } from '#lib/shared/relationship-model.js';
import type { MergeChoices, MergeConflict } from '#lib/shared/union-merge.js';
import type { FocusGraphDto, TreeSummaryDto, WholeTreeGraphDto } from '#lib/shared/graph-views.js';
import type { LayoutMode } from '#lib/shared/view-mode.js';
import type { PersonPageDto } from '#lib/shared/person-page.js';
import type { UnionPageDto } from '#lib/shared/union-page.js';
import type {
	CitationInput,
	CitationSubjectRef,
	RepositoryInput,
	RepositoryListItem,
	SourceDto,
	SourceInput,
	SourceListItem
} from '#lib/shared/evidence.js';
import type {
	NoteListItem,
	NoteSubjectRef,
	SharedNoteDto,
	SharedNoteInput
} from '#lib/shared/notes.js';
import type { TaskDto, TaskInput, TaskPageDto, TaskSubjectRef } from '#lib/shared/tasks.js';
import type { FactInput } from '#lib/shared/fact-types.js';
import type { NameInput } from '#lib/shared/name-types.js';
import type { SearchResponse } from '#lib/shared/search.js';
import type { MarksDto } from '#lib/shared/marks.js';
import type { PersonPrivacy } from '#lib/shared/privacy.js';
import type { PrivacySettingsDto } from '#lib/shared/privacy.js';
import type { InvitationSentDto, MemberDto, MembersDto } from '#lib/shared/members.js';
import type { TreeRole } from '#lib/shared/roles.js';
import type { RelationshipDto } from '#lib/shared/kinship.js';
import type { DescendantsDto, PedigreeDto } from '#lib/shared/charts.js';
import type { QualityReport } from '#lib/shared/quality.js';
import type { PersonMergeChoices, PersonMergeReviewDto } from '#lib/shared/person-merge.js';
import { MAX_PLACE_SUGGESTIONS, type PlaceDto, type PlaceListItem } from '#lib/shared/places.js';
import type {
	IndividualListItem,
	Page,
	SurnameListItem,
	UnionListItem
} from '#lib/shared/lists.js';

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
			entity:
				| 'individual'
				| 'union'
				| 'fact'
				| 'source'
				| 'repository'
				| 'citation'
				| 'source_link'
				| 'note'
				| 'note_link'
				| 'task';
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

/**
 * Whether a failed export call means the instance is gone for good: the workflow no longer knows it
 * (HTTP 404) or its file aged out (HTTP 410). A caller must then forget the instance and its client
 * id, so the next export starts a new instance rather than resuming one that can never succeed.
 */
export function isExpiredExportError(error: unknown): boolean {
	return error instanceof ApiError && (error.status === 404 || error.status === 410);
}

/**
 * Send the browser through `/login` after the session expired. It must be a full navigation, not
 * `goto`: only Access, which sees the request, can renew the cookie, and `/login` is the one path
 * it covers. Does nothing outside the browser.
 */
export function restartSignIn(): void {
	if (!browser) return;
	window.location.assign(
		`/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`
	);
}

async function call<T>(
	url: string,
	init: RequestInit | undefined,
	failure: string,
	fetchFn: typeof fetch = fetch
): Promise<T> {
	const res = await fetchFn(url, init);
	const data = (await res.json().catch(() => ({}))) as Record<string, any>;
	if (!res.ok) {
		// The error is still thrown, so callers stop while the page navigates away.
		if (res.status === 401) restartSignIn();
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

export async function createPersonApi(
	treeId: string,
	data: PersonFormData
): Promise<{ id: string; change: ChangeSummary | null }> {
	const res = await call<{ individual: { id: string }; change: ChangeSummary | null }>(
		`/api/trees/${treeId}/people`,
		json('POST', data),
		'Failed to add individual.'
	);
	return { id: res.individual.id, change: res.change };
}

/** `version` is the person's version when the form was opened; a newer stored version is a conflict. */
export async function updatePersonApi(
	treeId: string,
	personId: string,
	data: Partial<PersonFormData>,
	version: number
): Promise<{ change: ChangeSummary | null }> {
	const res = await call<{ change: ChangeSummary | null }>(
		`/api/trees/${treeId}/people/${personId}`,
		json('PUT', { ...data, version }),
		'Failed to update person.'
	);
	return { change: res.change };
}

export async function deletePersonApi(
	treeId: string,
	personId: string,
	version: number | undefined
): Promise<{ change: ChangeSummary | null }> {
	const query = version === undefined ? '' : `?version=${version}`;
	const res = await call<{ change: ChangeSummary | null }>(
		`/api/trees/${treeId}/people/${personId}${query}`,
		{ method: 'DELETE' },
		'Failed to delete person'
	);
	return { change: res.change };
}

/** Attach a photo or document to a person; the server checks the caller may add media to them. */
export async function uploadMediaApi(treeId: string, personId: string, file: File): Promise<void> {
	const body = new FormData();
	body.append('file', file);
	body.append('treeId', treeId);
	body.append('entityId', personId);
	body.append('title', file.name);
	await call('/api/media/upload', { method: 'POST', body }, 'Upload failed');
}

export async function previewGedcomImport(
	file: File,
	treeId?: string | null
): Promise<import('#lib/types/genealogy.js').ImportPreviewData> {
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
): Promise<{
	individualsCount?: number;
	familiesCount?: number;
	mergedFamiliesCount?: number;
	treeId?: string;
}> {
	const fd = new FormData();
	fd.append('file', file);
	fd.append('mode', mode);
	if (treeId) {
		fd.append('treeId', treeId);
	}
	if (options.shouldMergeDuplicateFamilies) fd.append('mergeDuplicates', 'true');
	return call('/api/import', { method: 'POST', body: fd }, 'Import failed');
}

/** How a tree is exported: the GEDCOM version and whether to package it as a `.gdz`. */
export interface GedcomExportChoice {
	format: 'gedcom7' | 'gedcom551';
	/** Only meaningful for 7.0: GEDZip is defined for 7.0 alone. */
	shouldCompress: boolean;
}

/** The download address for a tree's export. A plain navigation, so the browser saves the file. */
export function gedcomExportUrl(treeId: string, choice: GedcomExportChoice): string {
	const params = new URLSearchParams({ treeId, format: choice.format });
	if (choice.shouldCompress && choice.format === 'gedcom7') params.set('package', 'gdz');
	return `/api/export?${params}`;
}

/** How an export started: built now, running in the workflow, or not available at all. */
export type GedcomExportStart =
	{ status: 'sync' } | { status: 'started'; instanceId: string } | { status: 'unavailable' };

/** The status an asynchronous export reports; a closed set the server owns. */
export interface GedcomExportStatus {
	status: 'queued' | 'running' | 'complete' | 'errored';
	code?: string;
}

const EXPORT_CLIENT_UUID_KEY = 'epoch.export.clientUuid';

/** sessionStorage, or null on the server and when a browser blocks it. */
function browserSession(): Storage | null {
	try {
		return typeof sessionStorage === 'undefined' ? null : sessionStorage;
	} catch {
		return null;
	}
}

/** The sessionStorage key holding one export choice's idempotency id. */
function exportClientUuidKey(treeId: string, choice: GedcomExportChoice): string {
	return `${EXPORT_CLIENT_UUID_KEY}:${treeId}:${choice.format}:${choice.shouldCompress ? 'gdz' : 'ged'}`;
}

/**
 * The idempotency id for one export choice, kept for the session, so a retry after a timeout names
 * the same workflow instance instead of starting a second. Keyed by tree, format and packaging, so
 * choosing a different file gets its own id; generated in the browser, never reused across choices.
 */
function exportClientUuid(treeId: string, choice: GedcomExportChoice): string {
	const key = exportClientUuidKey(treeId, choice);
	const store = browserSession();
	const existing = store?.getItem(key);
	if (existing) return existing;
	const fresh = crypto.randomUUID();
	store?.setItem(key, fresh);
	return fresh;
}

/**
 * Forget the idempotency id for one export choice once the export has finished (or been downloaded).
 * A finished instance's id names an already-built file the server would serve again as "already
 * started", so the next export of the same tree/format/package must mint a new id and thus a new
 * instance. A timed-out export is not terminal — it is still running and is resumed by the same id —
 * so the caller never clears on timeout.
 */
export function clearExportClientUuid(treeId: string, choice: GedcomExportChoice): void {
	try {
		browserSession()?.removeItem(exportClientUuidKey(treeId, choice));
	} catch {
		// A blocked store only costs a fresh id on the next export, never the export itself.
	}
}

/**
 * Ask the server how to make an export. The response is inspected directly rather than through
 * `call`: a 503 is an answer (`unavailable`), not a failure to throw, so the caller can tell it
 * apart from a real error and refuse to fall back to a synchronous download.
 */
export async function startGedcomExport(
	treeId: string,
	choice: GedcomExportChoice
): Promise<GedcomExportStart> {
	const response = await fetch('/api/export', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			treeId,
			clientUuid: exportClientUuid(treeId, choice),
			format: choice.format,
			shouldCompress: choice.shouldCompress
		})
	});
	if (response.status === 503) return { status: 'unavailable' };
	if (!response.ok) {
		if (response.status === 401) restartSignIn();
		const data = (await response.json().catch(() => ({}))) as {
			error?: string;
			code?: string;
			details?: Record<string, unknown>;
		};
		throw new ApiError(
			data.error || 'Failed to start the export',
			response.status,
			data.code,
			data.details
		);
	}
	const body = (await response.json().catch(() => ({}))) as {
		status?: string;
		instanceId?: string;
	};
	if (body.status === 'started' && body.instanceId) {
		return { status: 'started', instanceId: body.instanceId };
	}
	return { status: 'sync' };
}

/** One poll of a running export. `signal` lets the caller abandon a superseded poll. */
export function exportStatusApi(
	instanceId: string,
	signal?: AbortSignal
): Promise<GedcomExportStatus> {
	return call(
		`/api/export/status/${encodeURIComponent(instanceId)}`,
		{ signal },
		'Failed to check the export'
	);
}

/** The address a finished export is saved from. A plain navigation, so the browser saves the file. */
export function exportDownloadUrl(instanceId: string): string {
	return `/api/export/download/${encodeURIComponent(instanceId)}`;
}

/** Preview an intent: the sentence, warnings and the exact records a save would write. Saves nothing. */
export async function planRelationshipApi(
	treeId: string,
	intent: RelationshipIntent
): Promise<RelationshipPlan> {
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
	return call(
		`/api/trees/${treeId}/relationships`,
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
		`/api/trees/${treeId}/relationships/remove`,
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
		`/api/trees/${treeId}/impact`,
		json('POST', request),
		'Failed to preview the impact'
	);
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
	const data = await call<{ treeImpact: TreeImpact }>(
		`/api/trees/${treeId}/impact`,
		json('POST', { kind: 'delete_tree' }),
		'Failed to preview the impact'
	);
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

export async function previewUnionMergeApi(
	treeId: string,
	request: MergeUnionsRequest
): Promise<MergePreviewResponse> {
	return call(
		`/api/trees/${treeId}/unions/merge`,
		json('POST', { ...request, isPreview: true }),
		'Failed to preview the merge'
	);
}

export async function mergeUnionsApi(
	treeId: string,
	request: MergeUnionsRequest
): Promise<{ change: ChangeSummary | null }> {
	const res = await call<{ change: ChangeSummary | null }>(
		`/api/trees/${treeId}/unions/merge`,
		json('POST', request),
		'Failed to merge the partnerships'
	);
	return { change: res.change };
}

/** Undo the signed-in user's most recent change. Refusals (a later change touched it) come back as ApiError. */
export async function undoApi(
	treeId: string
): Promise<{ undone: { id: string; summary: string } }> {
	return call(`/api/trees/${treeId}/undo`, { method: 'POST' }, 'Failed to undo');
}

export async function fetchRelationshipGraph(treeId: string): Promise<RelationshipGraph> {
	const data = await call<{ graph: RelationshipGraph }>(
		`/api/trees/${treeId}/graph`,
		undefined,
		'Failed to load relationship graph'
	);
	return data.graph;
}

export async function searchPeopleApi(
	treeId: string,
	query: string
): Promise<PeopleSearchResult[]> {
	const data = await call<{ people?: PeopleSearchResult[] }>(
		`/api/trees/${treeId}/people-search?q=${encodeURIComponent(query)}`,
		undefined,
		'Failed to search people'
	);
	return data.people || [];
}

/** The search page's results for its own URL parameters (`q`, `place`, `from`, `to`, `offset`). */
export function searchTreeApi(
	treeId: string,
	params: URLSearchParams,
	fetchFn: typeof fetch = fetch
): Promise<SearchResponse> {
	return call(
		`/api/trees/${treeId}/search?${params}`,
		undefined,
		'Failed to search the tree',
		fetchFn
	);
}

/** One page of a list, for the list page's own URL parameters. */
export function fetchList<T extends IndividualListItem | UnionListItem | SurnameListItem>(
	treeId: string,
	list: 'individuals' | 'unions' | 'surnames',
	params: URLSearchParams,
	fetchFn: typeof fetch = fetch
): Promise<Page<T>> {
	return call(
		`/api/trees/${treeId}/lists/${list}?${params}`,
		undefined,
		'Failed to load the list',
		fetchFn
	);
}

export function fetchMarks(treeId: string, fetchFn: typeof fetch = fetch): Promise<MarksDto> {
	return call(
		`/api/trees/${treeId}/marks`,
		undefined,
		'Failed to load favourites and recents',
		fetchFn
	);
}

/** Record a visit; answers with the user's marks as they now stand. */
export function recordRecentApi(treeId: string, personId: string): Promise<MarksDto> {
	return call(
		`/api/trees/${treeId}/marks/recents`,
		json('POST', { personId }),
		'Failed to record the visit'
	);
}

export function setFavoriteApi(
	treeId: string,
	personId: string,
	isFavorite: boolean
): Promise<MarksDto> {
	return call(
		`/api/trees/${treeId}/marks/favorites/${encodeURIComponent(personId)}`,
		{ method: isFavorite ? 'PUT' : 'DELETE' },
		'Failed to change the favourite'
	);
}

// ---- Bounded reads (Phase 3) ----
// These take the `fetch` a SvelteKit load function hands them, so a server render forwards the
// caller's identity and the browser reuses the response.

const enc = encodeURIComponent;

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

export function fetchPersonPage(
	treeId: string,
	personId: string,
	fetchFn: typeof fetch = fetch
): Promise<PersonPageDto> {
	return call(
		`/api/trees/${enc(treeId)}/people/${enc(personId)}`,
		undefined,
		'Failed to load the person',
		fetchFn
	);
}

export function fetchUnionPage(
	treeId: string,
	unionId: string,
	fetchFn: typeof fetch = fetch
): Promise<UnionPageDto> {
	return call(
		`/api/trees/${enc(treeId)}/unions/${enc(unionId)}`,
		undefined,
		'Failed to load the partnership',
		fetchFn
	);
}

// ---- Facts ----

export async function createFactApi(
	treeId: string,
	personId: string,
	fact: FactInput
): Promise<{ factId: string; change: ChangeSummary | null }> {
	return call(
		`/api/trees/${enc(treeId)}/people/${enc(personId)}/facts`,
		json('POST', fact),
		'Failed to add the fact'
	);
}

export async function updateFactApi(
	treeId: string,
	factId: string,
	fact: Partial<FactInput>,
	version: number
): Promise<{ change: ChangeSummary | null }> {
	return call(
		`/api/trees/${enc(treeId)}/facts/${enc(factId)}`,
		json('PUT', { ...fact, version }),
		'Failed to save the fact'
	);
}

export async function deleteFactApi(
	treeId: string,
	factId: string,
	version: number
): Promise<{ change: ChangeSummary | null }> {
	return call(
		`/api/trees/${enc(treeId)}/facts/${enc(factId)}?version=${version}`,
		{ method: 'DELETE' },
		'Failed to remove the fact'
	);
}

export async function reorderFactsApi(
	treeId: string,
	personId: string,
	orderedFactIds: string[]
): Promise<{ change: ChangeSummary | null }> {
	return call(
		`/api/trees/${enc(treeId)}/people/${enc(personId)}/facts/reorder`,
		json('POST', { orderedFactIds }),
		'Failed to reorder the facts'
	);
}

export type FactImpactRequest =
	| { kind: 'create_fact'; personId: string; fact: FactInput }
	| { kind: 'update_fact'; factId: string; version?: number; fact: Partial<FactInput> }
	| { kind: 'delete_fact'; factId: string; version?: number };

export async function previewFactApi(
	treeId: string,
	request: FactImpactRequest
): Promise<ImpactSummary> {
	const data = await call<{ impact: ImpactSummary }>(
		`/api/trees/${enc(treeId)}/facts/impact`,
		json('POST', request),
		'Failed to preview the change'
	);
	return data.impact;
}

// ---- Names ----

export async function createNameApi(
	treeId: string,
	personId: string,
	name: NameInput,
	isPreferred = false
): Promise<{ nameId: string; change: ChangeSummary | null }> {
	return call(
		`/api/trees/${enc(treeId)}/people/${enc(personId)}/names`,
		json('POST', { ...name, isPreferred }),
		'Failed to add the name'
	);
}

export async function updateNameApi(
	treeId: string,
	nameId: string,
	name: Partial<NameInput>,
	version: number
): Promise<{ change: ChangeSummary | null }> {
	return call(
		`/api/trees/${enc(treeId)}/names/${enc(nameId)}`,
		json('PUT', { ...name, version }),
		'Failed to save the name'
	);
}

export async function deleteNameApi(
	treeId: string,
	nameId: string,
	version: number
): Promise<{ change: ChangeSummary | null }> {
	return call(
		`/api/trees/${enc(treeId)}/names/${enc(nameId)}?version=${version}`,
		{ method: 'DELETE' },
		'Failed to remove the name'
	);
}

export async function reorderNamesApi(
	treeId: string,
	personId: string,
	orderedNameIds: string[]
): Promise<{ change: ChangeSummary | null }> {
	return call(
		`/api/trees/${enc(treeId)}/people/${enc(personId)}/names/reorder`,
		json('POST', { orderedNameIds }),
		'Failed to reorder the names'
	);
}

export async function setPreferredNameApi(
	treeId: string,
	personId: string,
	nameId: string,
	version?: number
): Promise<{ change: ChangeSummary | null }> {
	return call(
		`/api/trees/${enc(treeId)}/people/${enc(personId)}/names/preferred`,
		json('POST', { nameId, version }),
		'Failed to choose the preferred name'
	);
}

/** Force a person public or private, or let their dates decide (`auto`). A manager's action. */
export async function setPersonPrivacyApi(
	treeId: string,
	personId: string,
	privacy: PersonPrivacy,
	version?: number
): Promise<{ change: ChangeSummary | null }> {
	return call(
		`/api/trees/${enc(treeId)}/people/${enc(personId)}/privacy`,
		json('PUT', { privacy, version }),
		'Failed to change the privacy of the person'
	);
}

export async function fetchPrivacySettings(
	treeId: string,
	fetcher: typeof fetch = fetch
): Promise<PrivacySettingsDto> {
	return call(
		`/api/trees/${enc(treeId)}/privacy`,
		{ method: 'GET' },
		'Failed to load the privacy settings',
		fetcher
	);
}

export async function savePrivacySettings(
	treeId: string,
	patch: Partial<PrivacySettingsDto>
): Promise<PrivacySettingsDto> {
	return call(
		`/api/trees/${enc(treeId)}/privacy`,
		json('PUT', patch),
		'Failed to save the privacy settings'
	);
}

/** The caller's own view in this tree; `null` clears it so the tree's default applies. */
export async function saveViewMode(treeId: string, mode: LayoutMode | null): Promise<void> {
	await call(
		`/api/trees/${enc(treeId)}/view-mode`,
		json('PUT', { mode }),
		'Failed to save the view'
	);
}

/** The tree `/` opens for the signed-in user; null clears it. */
export async function saveDefaultTree(treeId: string | null): Promise<void> {
	await call('/api/default-tree', json('PUT', { treeId }), 'Failed to save the default tree');
}

/** The view members with no choice of their own get; the owner's to set. */
export async function saveDefaultViewMode(treeId: string, mode: LayoutMode | null): Promise<void> {
	await call(
		`/api/trees/${enc(treeId)}/default-view`,
		json('PUT', { mode }),
		'Failed to save the default view'
	);
}

export type { InvitationSentDto, MemberDto, MembersDto };

export async function fetchMembers(
	treeId: string,
	fetcher: typeof fetch = fetch
): Promise<MembersDto> {
	return call(
		`/api/trees/${enc(treeId)}/members`,
		{ method: 'GET' },
		'Failed to load the members',
		fetcher
	);
}

export async function inviteMemberApi(
	treeId: string,
	email: string,
	role: TreeRole
): Promise<InvitationSentDto> {
	return call(
		`/api/trees/${enc(treeId)}/invitations`,
		json('POST', { email, role }),
		'Failed to send the invitation'
	);
}

export async function withdrawInvitationApi(treeId: string, invitationId: string): Promise<void> {
	await call(
		`/api/trees/${enc(treeId)}/invitations/${enc(invitationId)}`,
		{ method: 'DELETE' },
		'Failed to withdraw the invitation'
	);
}

export async function changeMemberRoleApi(
	treeId: string,
	userId: string,
	role: TreeRole,
	version: number
): Promise<MemberDto> {
	return call(
		`/api/trees/${enc(treeId)}/members/${enc(userId)}`,
		json('PATCH', { role, version }),
		'Failed to change the role'
	);
}

export async function removeMemberApi(
	treeId: string,
	userId: string,
	version: number
): Promise<void> {
	await call(
		`/api/trees/${enc(treeId)}/members/${enc(userId)}?version=${version}`,
		{ method: 'DELETE' },
		'Failed to remove the member'
	);
}

export async function fetchRelationship(
	treeId: string,
	fromId: string,
	toId: string,
	fetcher: typeof fetch = fetch
): Promise<RelationshipDto> {
	return call(
		`/api/trees/${enc(treeId)}/relationship?from=${encodeURIComponent(fromId)}&to=${encodeURIComponent(toId)}`,
		{ method: 'GET' },
		'Failed to work out the relationship',
		fetcher
	);
}

export async function fetchPedigree(
	treeId: string,
	personId: string,
	generations: number,
	fetcher: typeof fetch = fetch
): Promise<PedigreeDto> {
	return call(
		`/api/trees/${enc(treeId)}/charts/pedigree?person=${encodeURIComponent(personId)}&generations=${generations}`,
		{ method: 'GET' },
		'Failed to load the pedigree',
		fetcher
	);
}

export async function fetchDescendants(
	treeId: string,
	personId: string,
	generations: number,
	fetcher: typeof fetch = fetch
): Promise<DescendantsDto> {
	return call(
		`/api/trees/${enc(treeId)}/charts/descendants?person=${encodeURIComponent(personId)}&generations=${generations}`,
		{ method: 'GET' },
		'Failed to load the descendants',
		fetcher
	);
}

export async function fetchPlaces(
	treeId: string,
	params: URLSearchParams,
	fetcher: typeof fetch = fetch
): Promise<Page<PlaceListItem>> {
	return call(
		`/api/trees/${enc(treeId)}/places?${params}`,
		{ method: 'GET' },
		'Failed to list the places',
		fetcher
	);
}

export async function fetchPlace(
	treeId: string,
	name: string,
	params: URLSearchParams,
	fetcher: typeof fetch = fetch
): Promise<PlaceDto> {
	const query = new URLSearchParams(params);
	query.set('name', name);
	return call(
		`/api/trees/${enc(treeId)}/places?${query}`,
		{ method: 'GET' },
		'Failed to load the place',
		fetcher
	);
}

/** Places whose text contains `text`, for the fact editor's suggestions. */
export async function suggestPlacesApi(treeId: string, text: string): Promise<string[]> {
	const data = await fetchPlaces(
		treeId,
		new URLSearchParams({ q: text, limit: String(MAX_PLACE_SUGGESTIONS) })
	);
	return data.items.map((p) => p.name);
}

/** Rename a place, or merge it into the place that already has `name`; one change, one undo. */
export async function rewritePlaceApi(
	treeId: string,
	placeId: string,
	name: string
): Promise<{ change: ChangeSummary | null; name: string }> {
	return call(
		`/api/trees/${enc(treeId)}/places/${enc(placeId)}`,
		json('PUT', { name }),
		'Failed to change the place'
	);
}

/** The dates that would take their standard spelling, before and after. Saves nothing. */
export async function previewStandardiseDatesApi(
	treeId: string
): Promise<import('#lib/shared/date-tidy.js').DateTidyPreview> {
	return call(
		`/api/trees/${enc(treeId)}/dates/standardise`,
		{},
		'Failed to preview standardising the dates'
	);
}

/** Give those dates their standard spelling: one change, one undo. */
export async function standardiseDatesApi(
	treeId: string
): Promise<{ change: ChangeSummary | null; remaining: number }> {
	return call(
		`/api/trees/${enc(treeId)}/dates/standardise`,
		{ method: 'POST' },
		'Failed to standardise the dates'
	);
}

export async function previewPlaceRewriteApi(
	treeId: string,
	placeId: string,
	name: string
): Promise<ImpactSummary> {
	const data = await call<{ impact: ImpactSummary }>(
		`/api/trees/${enc(treeId)}/places/${enc(placeId)}/impact`,
		json('POST', { name }),
		'Failed to preview the change'
	);
	return data.impact;
}

export async function fetchQuality(
	treeId: string,
	fetcher: typeof fetch = fetch
): Promise<QualityReport> {
	return call(
		`/api/trees/${enc(treeId)}/quality`,
		{ method: 'GET' },
		'Failed to load the report',
		fetcher
	);
}

/** Dismisses every finding named with the one reason, or none of them. */
export async function dismissFindingsApi(
	treeId: string,
	keys: string[],
	reason: string
): Promise<void> {
	await call(
		`/api/trees/${enc(treeId)}/quality`,
		json('PUT', { keys, reason }),
		keys.length === 1 ? 'Failed to dismiss the finding' : 'Failed to dismiss the findings'
	);
}

export async function restoreFindingApi(treeId: string, key: string): Promise<void> {
	await call(
		`/api/trees/${enc(treeId)}/quality?key=${enc(key)}`,
		{ method: 'DELETE' },
		'Failed to restore the finding'
	);
}

export interface PersonMergeBody {
	mergedId: string;
	keep?: PersonMergeChoices;
	expectedVersions?: Record<string, number>;
}

/** Both records side by side, and what the merge needs decided first. Writes nothing. */
export async function reviewPersonMergeApi(
	treeId: string,
	survivorId: string,
	body: PersonMergeBody
): Promise<{ review: PersonMergeReviewDto; impact: ImpactSummary | null }> {
	return call(
		`/api/trees/${enc(treeId)}/people/${enc(survivorId)}/merge/impact`,
		json('POST', body),
		'Failed to review the merge'
	);
}

export async function mergePeopleApi(
	treeId: string,
	survivorId: string,
	body: PersonMergeBody
): Promise<{ change: ChangeSummary | null }> {
	return call(
		`/api/trees/${enc(treeId)}/people/${enc(survivorId)}/merge`,
		json('POST', body),
		'Failed to merge the people'
	);
}

export type NameImpactRequest =
	| { kind: 'create_name'; personId: string; name: NameInput & { isPreferred?: boolean } }
	| { kind: 'update_name'; nameId: string; version?: number; name: Partial<NameInput> }
	| { kind: 'delete_name'; nameId: string; version?: number }
	| { kind: 'set_preferred_name'; personId: string; nameId: string; version?: number };

export async function previewNameApi(
	treeId: string,
	request: NameImpactRequest
): Promise<ImpactSummary> {
	const data = await call<{ impact: ImpactSummary }>(
		`/api/trees/${enc(treeId)}/names/impact`,
		json('POST', request),
		'Failed to preview the change'
	);
	return data.impact;
}

// ---- Sources, repositories and citations (ADR-028) ----

type Changed = { change: ChangeSummary | null };

export async function fetchSources(
	treeId: string,
	params: URLSearchParams,
	fetcher: typeof fetch = fetch
): Promise<Page<SourceListItem>> {
	return call(
		`/api/trees/${enc(treeId)}/lists/sources?${params}`,
		{ method: 'GET' },
		'Failed to list the sources',
		fetcher
	);
}

export async function fetchRepositories(
	treeId: string,
	params: URLSearchParams,
	fetcher: typeof fetch = fetch
): Promise<Page<RepositoryListItem>> {
	return call(
		`/api/trees/${enc(treeId)}/lists/repositories?${params}`,
		{ method: 'GET' },
		'Failed to list the repositories',
		fetcher
	);
}

export async function fetchSource(
	treeId: string,
	sourceId: string,
	params: URLSearchParams,
	fetcher: typeof fetch = fetch
): Promise<SourceDto> {
	return call(
		`/api/trees/${enc(treeId)}/sources/${enc(sourceId)}?${params}`,
		{ method: 'GET' },
		'Failed to load the source',
		fetcher
	);
}

export async function createSourceApi(
	treeId: string,
	source: SourceInput
): Promise<{ sourceId: string; change: ChangeSummary | null }> {
	return call(
		`/api/trees/${enc(treeId)}/sources`,
		json('POST', source),
		'Failed to add the source'
	);
}

export async function updateSourceApi(
	treeId: string,
	sourceId: string,
	source: SourceInput,
	version: number
): Promise<Changed> {
	return call(
		`/api/trees/${enc(treeId)}/sources/${enc(sourceId)}`,
		json('PUT', { ...source, version }),
		'Failed to save the source'
	);
}

export async function deleteSourceApi(
	treeId: string,
	sourceId: string,
	options: { version: number; shouldRemoveCitations?: boolean }
): Promise<Changed> {
	const query = new URLSearchParams({ version: String(options.version) });
	if (options.shouldRemoveCitations) query.set('removeCitations', 'true');
	return call(
		`/api/trees/${enc(treeId)}/sources/${enc(sourceId)}?${query}`,
		{ method: 'DELETE' },
		'Failed to delete the source'
	);
}

export async function mergeSourcesApi(
	treeId: string,
	survivorId: string,
	body: { mergedIds: string[]; expectedVersions?: Record<string, number> }
): Promise<Changed> {
	return call(
		`/api/trees/${enc(treeId)}/sources/${enc(survivorId)}/merge`,
		json('POST', body),
		'Failed to merge the sources'
	);
}

export type EvidenceImpactRequest =
	| { kind: 'delete_source'; sourceId: string; version?: number; shouldRemoveCitations?: boolean }
	| { kind: 'merge_sources'; survivorId: string; mergedIds: string[] }
	| { kind: 'remove_citation'; citationId: string; version?: number }
	| { kind: 'delete_repository'; repositoryId: string; version?: number };

export async function previewEvidenceApi(
	treeId: string,
	request: EvidenceImpactRequest
): Promise<ImpactSummary> {
	const data = await call<{ impact: ImpactSummary }>(
		`/api/trees/${enc(treeId)}/sources/impact`,
		json('POST', request),
		'Failed to preview the change'
	);
	return data.impact;
}

export async function createRepositoryApi(
	treeId: string,
	repository: RepositoryInput
): Promise<{ repositoryId: string; change: ChangeSummary | null }> {
	return call(
		`/api/trees/${enc(treeId)}/repositories`,
		json('POST', repository),
		'Failed to add the repository'
	);
}

export async function updateRepositoryApi(
	treeId: string,
	repositoryId: string,
	repository: RepositoryInput,
	version: number
): Promise<Changed> {
	return call(
		`/api/trees/${enc(treeId)}/repositories/${enc(repositoryId)}`,
		json('PUT', { ...repository, version }),
		'Failed to save the repository'
	);
}

export async function deleteRepositoryApi(
	treeId: string,
	repositoryId: string,
	version: number
): Promise<Changed> {
	return call(
		`/api/trees/${enc(treeId)}/repositories/${enc(repositoryId)}?version=${version}`,
		{ method: 'DELETE' },
		'Failed to delete the repository'
	);
}

export async function linkRepositoryApi(
	treeId: string,
	sourceId: string,
	body: { repositoryId: string; callNumber: string | null }
): Promise<{ linkId: string; change: ChangeSummary | null }> {
	return call(
		`/api/trees/${enc(treeId)}/sources/${enc(sourceId)}/repositories`,
		json('POST', body),
		'Failed to link the repository'
	);
}

export async function updateSourceLinkApi(
	treeId: string,
	linkId: string,
	callNumber: string | null,
	version: number
): Promise<Changed> {
	return call(
		`/api/trees/${enc(treeId)}/source-links/${enc(linkId)}`,
		json('PUT', { callNumber, version }),
		'Failed to save the call number'
	);
}

export async function unlinkRepositoryApi(
	treeId: string,
	linkId: string,
	version: number
): Promise<Changed> {
	return call(
		`/api/trees/${enc(treeId)}/source-links/${enc(linkId)}?version=${version}`,
		{ method: 'DELETE' },
		'Failed to unlink the repository'
	);
}

export async function addCitationApi(
	treeId: string,
	subject: CitationSubjectRef,
	citation: CitationInput
): Promise<{ citationId: string; change: ChangeSummary | null }> {
	return call(
		`/api/trees/${enc(treeId)}/citations`,
		json('POST', { subject, ...citation }),
		'Failed to add the citation'
	);
}

export async function updateCitationApi(
	treeId: string,
	citationId: string,
	citation: CitationInput,
	version: number
): Promise<Changed> {
	return call(
		`/api/trees/${enc(treeId)}/citations/${enc(citationId)}`,
		json('PUT', { ...citation, version }),
		'Failed to save the citation'
	);
}

export async function removeCitationApi(
	treeId: string,
	citationId: string,
	version: number
): Promise<Changed> {
	return call(
		`/api/trees/${enc(treeId)}/citations/${enc(citationId)}?version=${version}`,
		{ method: 'DELETE' },
		'Failed to remove the citation'
	);
}

export async function reorderCitationsApi(
	treeId: string,
	subject: CitationSubjectRef,
	orderedCitationIds: string[]
): Promise<Changed> {
	return call(
		`/api/trees/${enc(treeId)}/citations/reorder`,
		json('POST', { subject, orderedCitationIds }),
		'Failed to reorder the citations'
	);
}

// ---- Notes (ADR-029) ----

export async function fetchNotes(
	treeId: string,
	params: URLSearchParams,
	fetcher: typeof fetch = fetch
): Promise<Page<NoteListItem>> {
	return call(
		`/api/trees/${enc(treeId)}/lists/notes?${params}`,
		{ method: 'GET' },
		'Failed to list the notes',
		fetcher
	);
}

export async function fetchNote(
	treeId: string,
	noteId: string,
	params: URLSearchParams,
	fetcher: typeof fetch = fetch
): Promise<SharedNoteDto> {
	return call(
		`/api/trees/${enc(treeId)}/notes/${enc(noteId)}?${params}`,
		{ method: 'GET' },
		'Failed to load the note',
		fetcher
	);
}

export async function createSharedNoteApi(
	treeId: string,
	note: SharedNoteInput & { text: string }
): Promise<{ noteId: string; change: ChangeSummary | null }> {
	return call(`/api/trees/${enc(treeId)}/notes`, json('POST', note), 'Failed to add the note');
}

export async function updateSharedNoteApi(
	treeId: string,
	noteId: string,
	note: SharedNoteInput,
	version: number
): Promise<Changed> {
	return call(
		`/api/trees/${enc(treeId)}/notes/${enc(noteId)}`,
		json('PUT', { ...note, version }),
		'Failed to save the note'
	);
}

export async function deleteSharedNoteApi(
	treeId: string,
	noteId: string,
	options: { version: number; shouldDetach?: boolean }
): Promise<Changed> {
	const query = new URLSearchParams({ version: String(options.version) });
	if (options.shouldDetach) query.set('detach', 'true');
	return call(
		`/api/trees/${enc(treeId)}/notes/${enc(noteId)}?${query}`,
		{ method: 'DELETE' },
		'Failed to delete the note'
	);
}

export async function mergeNotesApi(
	treeId: string,
	survivorId: string,
	body: { mergedIds: string[]; expectedVersions?: Record<string, number> }
): Promise<Changed> {
	return call(
		`/api/trees/${enc(treeId)}/notes/${enc(survivorId)}/merge`,
		json('POST', body),
		'Failed to merge the notes'
	);
}

export type NoteImpactRequest =
	| { kind: 'delete_shared_note'; noteId: string; version?: number; shouldDetach?: boolean }
	| { kind: 'merge_notes'; survivorId: string; mergedIds: string[] }
	| { kind: 'remove_note'; attachmentId: string; version?: number };

export async function previewNoteApi(
	treeId: string,
	request: NoteImpactRequest
): Promise<ImpactSummary> {
	const data = await call<{ impact: ImpactSummary }>(
		`/api/trees/${enc(treeId)}/notes/impact`,
		json('POST', request),
		'Failed to preview the change'
	);
	return data.impact;
}

/** Put a note on a record: its words written there. */
export async function addNoteApi(
	treeId: string,
	subject: NoteSubjectRef,
	text: string
): Promise<{ attachmentId: string; change: ChangeSummary | null }> {
	return call(
		`/api/trees/${enc(treeId)}/note-links`,
		json('POST', { subject, text }),
		'Failed to add the note'
	);
}

/** Put an existing shared note on a record. */
export async function attachNoteApi(
	treeId: string,
	subject: NoteSubjectRef,
	noteId: string
): Promise<{ attachmentId: string; change: ChangeSummary | null }> {
	return call(
		`/api/trees/${enc(treeId)}/note-links`,
		json('POST', { subject, noteId }),
		'Failed to attach the note'
	);
}

export async function updateNoteApi(
	treeId: string,
	attachmentId: string,
	text: string,
	version: number
): Promise<Changed> {
	return call(
		`/api/trees/${enc(treeId)}/note-links/${enc(attachmentId)}`,
		json('PUT', { text, version }),
		'Failed to save the note'
	);
}

export async function removeNoteApi(
	treeId: string,
	attachmentId: string,
	version: number
): Promise<Changed> {
	return call(
		`/api/trees/${enc(treeId)}/note-links/${enc(attachmentId)}?version=${version}`,
		{ method: 'DELETE' },
		'Failed to remove the note'
	);
}

export async function shareNoteApi(
	treeId: string,
	attachmentId: string,
	version: number
): Promise<{ noteId: string; change: ChangeSummary | null }> {
	return call(
		`/api/trees/${enc(treeId)}/note-links/${enc(attachmentId)}/share`,
		json('POST', { version }),
		'Failed to share the note'
	);
}

export async function reorderNotesApi(
	treeId: string,
	subject: NoteSubjectRef,
	orderedAttachmentIds: string[]
): Promise<Changed> {
	return call(
		`/api/trees/${enc(treeId)}/note-links/reorder`,
		json('POST', { subject, orderedAttachmentIds }),
		'Failed to reorder the notes'
	);
}

// ---- Research tasks (ADR-029) ----

export async function fetchTasks(
	treeId: string,
	params: URLSearchParams,
	fetcher: typeof fetch = fetch
): Promise<TaskPageDto> {
	return call(
		`/api/trees/${enc(treeId)}/tasks?${params}`,
		{ method: 'GET' },
		'Failed to list the tasks',
		fetcher
	);
}

export async function fetchTask(treeId: string, taskId: string): Promise<TaskDto> {
	return call(
		`/api/trees/${enc(treeId)}/tasks/${enc(taskId)}`,
		{ method: 'GET' },
		'Failed to load the task'
	);
}

export async function createTaskApi(
	treeId: string,
	task: TaskInput & { title: string },
	link: { subject?: TaskSubjectRef | null; findingKey?: string | null } = {}
): Promise<{ taskId: string; change: ChangeSummary | null }> {
	return call(
		`/api/trees/${enc(treeId)}/tasks`,
		json('POST', { ...task, subject: link.subject ?? null, findingKey: link.findingKey ?? null }),
		'Failed to add the task'
	);
}

export async function updateTaskApi(
	treeId: string,
	taskId: string,
	task: TaskInput,
	version: number
): Promise<Changed> {
	return call(
		`/api/trees/${enc(treeId)}/tasks/${enc(taskId)}`,
		json('PUT', { ...task, version }),
		'Failed to save the task'
	);
}

export async function deleteTaskApi(
	treeId: string,
	taskId: string,
	version: number
): Promise<Changed> {
	return call(
		`/api/trees/${enc(treeId)}/tasks/${enc(taskId)}?version=${version}`,
		{ method: 'DELETE' },
		'Failed to delete the task'
	);
}

export async function previewDeleteTaskApi(
	treeId: string,
	taskId: string,
	version: number
): Promise<ImpactSummary> {
	const data = await call<{ impact: ImpactSummary }>(
		`/api/trees/${enc(treeId)}/tasks/impact`,
		json('POST', { taskId, version }),
		'Failed to preview the change'
	);
	return data.impact;
}
