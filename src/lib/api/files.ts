import type {
	DeleteUnlinkedResponse,
	FileLinkResponse,
	FileListResponse,
	FileUsageResponse,
	ImportResponse,
	ImportStatusResponse,
	UnlinkedListResponse
} from '#lib/shared/api-contracts.js';
import type { FileListDto, FileUsageDto, UnlinkedListDto } from '#lib/shared/files.js';
import { ApiError, call, json, path, restartSignIn } from './client.js';

/**
 * Files a finished upload session as media on a person, partnership or source. The bytes are
 * already stored, so this sends only the session and the record; the server checks them again.
 */
export async function mediaFromUploadApi(input: {
	sessionId: string;
	entityId: string;
	title: string;
}): Promise<void> {
	await call('/api/media/from-upload', json('POST', input), 'Could not add the file');
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

/** What an import answers; see `ImportResponse`. */
export type GedcomImportResult = ImportResponse;

/** What the archive would add, from the uploaded `.gdz`'s directory and dataset alone. */
export function previewGedzipImport(
	sessionId: string
): Promise<import('#lib/types/genealogy.js').ImportPreviewData> {
	return call(path`/api/uploads/${sessionId}/preview`, {}, 'Failed to preview the archive');
}

/** Starts the import of an uploaded `.gdz`; a second start of the same upload is a 409. */
export function startGedzipImport(
	sessionId: string,
	input: { mode: 'replace' | 'merge'; shouldMergeDuplicateFamilies: boolean; isNewTree?: boolean }
): Promise<GedcomImportResult> {
	return call<ImportResponse>(
		path`/api/uploads/${sessionId}/import`,
		json('POST', input),
		'Import failed'
	);
}

export async function submitGedcomImport(
	file: File,
	mode: 'replace' | 'merge',
	treeId?: string | null,
	options: { shouldMergeDuplicateFamilies?: boolean } = {}
): Promise<GedcomImportResult> {
	const fd = new FormData();
	fd.append('file', file);
	fd.append('mode', mode);
	if (treeId) {
		fd.append('treeId', treeId);
	}
	if (options.shouldMergeDuplicateFamilies) fd.append('mergeDuplicates', 'true');
	return call<ImportResponse>('/api/import', { method: 'POST', body: fd }, 'Import failed');
}

/** One poll of a queued import. `signal` lets the caller abandon a superseded poll. */
export function importStatusApi(
	jobId: string,
	signal?: AbortSignal
): Promise<ImportStatusResponse> {
	return call<ImportStatusResponse>(
		path`/api/import/${jobId}`,
		{ signal },
		'Failed to check the import'
	);
}

/** How a tree is exported: the GEDCOM version and whether to package it as a `.gdz`. */
export interface GedcomExportChoice {
	format: 'gedcom7' | 'gedcom551';
	/** Only meaningful for 7.0: GEDZip is defined for 7.0 alone. */
	shouldCompress: boolean;
	/** Only meaningful for a 7.0 `.gdz`. Absent, not false, when unchecked: the request omits it. */
	shouldIncludeMedia?: true;
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
	// A media export is its own file, so it must not reuse a plain `.gdz` export's id.
	const packaging = choice.shouldCompress
		? choice.shouldIncludeMedia
			? 'gdz-media'
			: 'gdz'
		: 'ged';
	return `${EXPORT_CLIENT_UUID_KEY}:${treeId}:${choice.format}:${packaging}`;
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
			shouldCompress: choice.shouldCompress,
			includeMedia: choice.shouldIncludeMedia
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
	return call(path`/api/export/status/${instanceId}`, { signal }, 'Failed to check the export');
}

/** The address a finished export is saved from. A plain navigation, so the browser saves the file. */
export function exportDownloadUrl(instanceId: string): string {
	return path`/api/export/download/${instanceId}`;
}

/** A page of the files the caller may see; `treeId` narrows it, `cursor` continues it. */
export async function fetchFiles(
	query: {
		treeId?: string | null;
		/** Only files on this person, partnership or source. */
		entityId?: string | null;
		/** Only files with no owner. */
		isDetachedOnly?: boolean;
		cursor?: string | null;
		limit?: number;
	},
	fetcher: typeof fetch = fetch
): Promise<FileListDto> {
	const params = new URLSearchParams();
	if (query.treeId) params.set('treeId', query.treeId);
	if (query.entityId) params.set('entityId', query.entityId);
	if (query.isDetachedOnly) params.set('owner', 'detached');
	if (query.cursor) params.set('cursor', query.cursor);
	if (query.limit) params.set('limit', String(query.limit));
	const qs = params.size > 0 ? `?${params}` : '';
	return call<FileListResponse>(
		`/api/files${qs}`,
		{ method: 'GET' },
		'Failed to load files',
		fetcher
	);
}

/** Storage used by the files the caller may see, optionally narrowed to one tree. */
export async function fetchFileUsage(
	treeId: string | null,
	fetcher: typeof fetch = fetch
): Promise<FileUsageDto> {
	const qs = treeId ? `?treeId=${encodeURIComponent(treeId)}` : '';
	return call<FileUsageResponse>(
		`/api/files/usage${qs}`,
		{ method: 'GET' },
		'Failed to read storage use',
		fetcher
	);
}

/** Renames a file. `version` is the one the caller last read, so a stale rename is refused. */
export async function renameFileApi(
	fileId: string,
	treeId: string,
	title: string,
	version: number | undefined
): Promise<void> {
	await call(
		path`/api/files/${fileId}`,
		json('PATCH', { treeId, title, version }),
		'Failed to rename the file'
	);
}

/** Deletes a file's row and then its bytes. Permanent: the server keeps no copy and no undo. */
export async function deleteFileApi(fileId: string, treeId: string): Promise<void> {
	await call(
		path`/api/files/${fileId}` + `?treeId=${encodeURIComponent(treeId)}`,
		{ method: 'DELETE' },
		'Failed to delete the file'
	);
}

/** Links a file to a person, partnership or source in the same tree. */
export async function linkFileApi(
	fileId: string,
	treeId: string,
	entityId: string,
	version: number | undefined
): Promise<FileLinkResponse> {
	return call(
		path`/api/files/${fileId}/links`,
		json('POST', { treeId, entityId, version }),
		'Failed to link the file'
	);
}

/**
 * Unlinks a file from one record, or from one of its facts when `factId` is given; the file itself
 * is kept. `fileId` names the object.
 */
export async function unlinkFileApi(
	fileId: string,
	treeId: string,
	entityId: string,
	version: number | undefined,
	factId?: string | null
): Promise<FileLinkResponse> {
	const query = new URLSearchParams({ treeId });
	if (version !== undefined) query.set('version', String(version));
	if (factId) query.set('factId', factId);
	return call(
		path`/api/files/${fileId}/links/${entityId}` + `?${query}`,
		{ method: 'DELETE' },
		'Failed to unlink the file'
	);
}

/** Stored objects that no file points at, in the trees the caller manages. */
export async function fetchUnlinkedFiles(
	treeId: string | null,
	fetcher: typeof fetch = fetch
): Promise<UnlinkedListDto> {
	const qs = treeId ? `?treeId=${encodeURIComponent(treeId)}` : '';
	return call<UnlinkedListResponse>(
		`/api/files/unlinked${qs}`,
		{ method: 'GET' },
		'Failed to list stored files',
		fetcher
	);
}

/** Deletes the unlinked objects a fresh listing finds. Permanent. */
export async function deleteUnlinkedFilesApi(
	treeId: string | null
): Promise<DeleteUnlinkedResponse> {
	const qs = treeId ? `?treeId=${encodeURIComponent(treeId)}` : '';
	return call<DeleteUnlinkedResponse>(
		`/api/files/unlinked${qs}`,
		{ method: 'DELETE' },
		'Failed to delete stored files'
	);
}

/**
 * Sets the title that overrides the file's for one record or fact; blank clears it. `fileId` names
 * the object and `version` is its version, so a stale edit is refused.
 */
export async function updateFileLinkTitleApi(input: {
	fileId: string;
	treeId: string;
	entityId: string;
	factId?: string | null;
	title: string | null;
	version: number | undefined;
}): Promise<FileLinkResponse> {
	return call(
		path`/api/files/${input.fileId}/links/${input.entityId}`,
		json('PATCH', {
			treeId: input.treeId,
			factId: input.factId ?? null,
			title: input.title,
			version: input.version
		}),
		'Failed to edit the link'
	);
}

/** Sets the order of every file on one record or fact; `orderedMediaIds` names objects, first first. */
export async function reorderFilesApi(input: {
	treeId: string;
	entityId: string;
	factId?: string | null;
	orderedMediaIds: string[];
}): Promise<FileLinkResponse> {
	return call(
		'/api/files/order',
		json('PUT', { ...input, factId: input.factId ?? null }),
		'Failed to reorder the files'
	);
}

/**
 * Gives an unresolved file the bytes of a finished upload ("Add file…"). `fileId` is the file's own
 * id, not its object's; `version` is the file's version.
 */
export async function resolveFileFromUploadApi(input: {
	fileId: string;
	sessionId: string;
	version: number | undefined;
}): Promise<FileLinkResponse> {
	return call(
		path`/api/media/${input.fileId}/resolve-from-upload`,
		json('POST', { sessionId: input.sessionId, version: input.version }),
		'Could not add the file'
	);
}
