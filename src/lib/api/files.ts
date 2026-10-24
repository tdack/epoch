import type { FileLinkResponse } from '#lib/shared/api-contracts.js';
import type { FileListDto, FileUsageDto, UnlinkedListDto } from '#lib/shared/files.js';
import { ApiError, call, json, path, restartSignIn } from './client.js';

/** Attach a photo or document to a person, partnership or source; the server checks the caller may add media to it. */
export async function uploadMediaApi(treeId: string, entityId: string, file: File): Promise<void> {
	const body = new FormData();
	body.append('file', file);
	body.append('treeId', treeId);
	body.append('entityId', entityId);
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
	return call(`/api/files${qs}`, { method: 'GET' }, 'Failed to load files', fetcher);
}

/** Storage used by the files the caller may see, optionally narrowed to one tree. */
export async function fetchFileUsage(
	treeId: string | null,
	fetcher: typeof fetch = fetch
): Promise<FileUsageDto> {
	const qs = treeId ? `?treeId=${encodeURIComponent(treeId)}` : '';
	return call(`/api/files/usage${qs}`, { method: 'GET' }, 'Failed to read storage use', fetcher);
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

/** Unlinks a file from one record; the file itself is kept. */
export async function unlinkFileApi(
	fileId: string,
	treeId: string,
	entityId: string,
	version: number | undefined
): Promise<FileLinkResponse> {
	const query = new URLSearchParams({ treeId });
	if (version !== undefined) query.set('version', String(version));
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
	return call(
		`/api/files/unlinked${qs}`,
		{ method: 'GET' },
		'Failed to list stored files',
		fetcher
	);
}

/** Deletes the unlinked objects a fresh listing finds. Permanent. */
export async function deleteUnlinkedFilesApi(
	treeId: string | null
): Promise<{ deleted: number; failed: number }> {
	const qs = treeId ? `?treeId=${encodeURIComponent(treeId)}` : '';
	return call(`/api/files/unlinked${qs}`, { method: 'DELETE' }, 'Failed to delete stored files');
}
