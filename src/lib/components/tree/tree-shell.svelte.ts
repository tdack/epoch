/**
 * The operations on trees as a whole, as opposed to on the people in one: create, rename, delete,
 * import and export. Used by the tree screens' shared header and by the landing page when no tree exists
 * yet, so both offer the same actions with the same dialogs.
 */

import { ApiError, isExpiredExportError } from '#lib/api/client.js';
import {
	clearExportClientUuid,
	exportDownloadUrl,
	exportStatusApi,
	gedcomExportUrl,
	importStatusApi,
	previewGedcomImport,
	previewGedzipImport,
	startGedcomExport,
	startGedzipImport,
	submitGedcomImport,
	type GedcomExportChoice,
	type GedcomImportResult
} from '#lib/api/files.js';
import { createTreeApi, deleteTreeApi } from '#lib/api/trees.js';
import { isAbortError, startUpload } from '#lib/api/uploader.js';
import { messageOf } from '#lib/components/feedback/error-message.js';
import type { ToastStore } from '#lib/components/feedback/toasts.svelte.js';
import { describeMediaResult } from '#lib/shared/media.js';
import type { ImportPreviewData } from '#lib/types/genealogy.js';

/** How long the client polls a running export before handing the instance back to be resumed. */
const EXPORT_POLL_TIMEOUT_MS = 120_000;
/** The first gap between polls, and the jitter added to each so a fleet of clients does not synchronise. */
const EXPORT_POLL_INITIAL_MS = 1_000;
/** The longest gap between polls. */
const EXPORT_POLL_MAX_MS = 10_000;
/** How long the client polls a queued import. A big file takes minutes; past this the job still runs. */
const IMPORT_POLL_TIMEOUT_MS = 600_000;
/** Where a timed-out export is remembered so the person can resume it. */
const PENDING_EXPORT_KEY = 'epoch.export.pending';

interface PendingExport {
	treeId: string;
	instanceId: string;
	choice: GedcomExportChoice;
}

/** sessionStorage, or null on the server and when a browser blocks it. */
function browserSession(): Storage | null {
	try {
		return typeof sessionStorage === 'undefined' ? null : sessionStorage;
	} catch {
		return null;
	}
}

function readPendingExport(): PendingExport | null {
	try {
		const raw = browserSession()?.getItem(PENDING_EXPORT_KEY);
		return raw ? (JSON.parse(raw) as PendingExport) : null;
	} catch {
		return null;
	}
}

function writePendingExport(pending: PendingExport | null): void {
	try {
		const store = browserSession();
		if (!store) return;
		if (pending) store.setItem(PENDING_EXPORT_KEY, JSON.stringify(pending));
		else store.removeItem(PENDING_EXPORT_KEY);
	} catch {
		// A blocked store only costs the resume offer, never the export itself.
	}
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface TreeShellOptions {
	/** The tree being viewed, or null on the landing page. */
	treeId: () => string | null;
	toasts: ToastStore;
	/** Reload the list of trees (and whatever else shows their names or counts). */
	reload: () => Promise<void>;
	/** Show a tree, or the landing page for null. */
	goTo: (treeId: string | null) => void;
}

export class TreeShell {
	// New tree
	isNewTreeModalOpen = $state(false);
	isCreatingTree = $state(false);
	createTreeError = $state<string | null>(null);

	// Import
	importStatus = $state<string | null>(null);
	isImporting = $state(false);
	isImportConfirmModalOpen = $state(false);
	pendingImportFile = $state<File | null>(null);
	importPreview = $state<ImportPreviewData | null>(null);
	isLoadingPreview = $state(false);
	isConfirmingImport = $state(false);
	importConfirmError = $state<string | null>(null);
	/** A `.gdz` on its way up; it goes up first so its media never has to pass through one request. */
	importUpload = $state<{
		fileName: string;
		uploadedBytes: number;
		totalBytes: number;
		phase: 'uploading' | 'failed';
		error: string | null;
	} | null>(null);
	/** Where a running `.gdz` import is up to, in words. */
	importProgressText = $state<string | null>(null);
	private gedzipSessionId: string | null = null;
	/** The tree made to hold a `.gdz` picked with no tree open; deleted if the import never starts. */
	private gedzipNewTreeId: string | null = null;
	private uploadAbort: AbortController | null = null;

	// Export
	isExporting = $state(false);
	exportStatus = $state<string | null>(null);
	exportError = $state<string | null>(null);
	/** The running export a timed-out attempt left behind, so the person can resume it. */
	pendingExportInstanceId = $state<string | null>(null);
	private exportAbort: AbortController | null = null;

	constructor(private options: TreeShellOptions) {}

	openNewTree = () => {
		this.createTreeError = null;
		this.isCreatingTree = false;
		this.isNewTreeModalOpen = true;
	};

	createTree = async (data: { name: string; description?: string }) => {
		this.createTreeError = null;
		this.isCreatingTree = true;
		try {
			const created = await createTreeApi(data);
			this.isNewTreeModalOpen = false;
			await this.options.reload();
			if (created?.id) this.options.goTo(created.id);
		} catch (e) {
			console.error('Failed to create tree', e);
			this.createTreeError = messageOf(e, 'Failed to create tree');
		} finally {
			this.isCreatingTree = false;
		}
	};

	exportGedcom = async (choice: GedcomExportChoice) => {
		const treeId = this.options.treeId();
		if (!treeId || this.isExporting) return;
		this.isExporting = true;
		this.exportError = null;
		try {
			const start = await startGedcomExport(treeId, choice);
			if (start.status === 'sync') {
				// Small enough to build in the request: navigate and let the browser save it. The download
				// is done, so forget the id: a later export of this choice is a new file, not this one.
				clearExportClientUuid(treeId, choice);
				window.location.href = gedcomExportUrl(treeId, choice);
				return;
			}
			if (start.status === 'unavailable') {
				// There is no synchronous fallback: an export that cannot run asynchronously is offered
				// again later, never silently replaced by a slower, size-limited download.
				this.options.toasts.push('Exports are unavailable right now. Please try again later.');
				return;
			}
			this.pendingExportInstanceId = start.instanceId;
			writePendingExport({ treeId, instanceId: start.instanceId, choice });
			await this.pollExport(start.instanceId, treeId, choice);
		} catch (err) {
			this.handleExportError(err, treeId, choice);
		} finally {
			this.isExporting = false;
		}
	};

	/** Resume an export a previous attempt left running, if it belongs to the tree being viewed. */
	resumeExport = async () => {
		const pending = readPendingExport();
		const treeId = this.options.treeId();
		if (!pending || !treeId || pending.treeId !== treeId || this.isExporting) return;
		this.isExporting = true;
		this.exportError = null;
		this.pendingExportInstanceId = pending.instanceId;
		try {
			await this.pollExport(pending.instanceId, pending.treeId, pending.choice);
		} catch (err) {
			this.handleExportError(err, pending.treeId, pending.choice);
		} finally {
			this.isExporting = false;
		}
	};

	private async pollExport(
		instanceId: string,
		treeId: string,
		choice: GedcomExportChoice
	): Promise<void> {
		// One poll in flight: a new attempt abandons whatever the last was waiting on.
		this.exportAbort?.abort();
		const controller = new AbortController();
		this.exportAbort = controller;
		const deadline = Date.now() + EXPORT_POLL_TIMEOUT_MS;
		let delay = EXPORT_POLL_INITIAL_MS;
		while (Date.now() < deadline) {
			await sleep(delay + Math.random() * EXPORT_POLL_INITIAL_MS);
			if (controller.signal.aborted) return;
			let status: string;
			try {
				({ status } = await exportStatusApi(instanceId, controller.signal));
			} catch (err) {
				if (controller.signal.aborted) return;
				throw err;
			}
			if (status === 'complete') {
				writePendingExport(null);
				// Done: forget the id so the next export of this choice mints a new instance.
				clearExportClientUuid(treeId, choice);
				this.pendingExportInstanceId = null;
				this.exportStatus = null;
				window.location.href = exportDownloadUrl(instanceId);
				return;
			}
			if (status === 'errored') {
				writePendingExport(null);
				// Terminal too: a retry must not name this failed instance, so mint a new id next time.
				clearExportClientUuid(treeId, choice);
				this.pendingExportInstanceId = null;
				this.exportStatus = null;
				this.options.toasts.push('The export failed. Please try again.');
				return;
			}
			this.exportStatus = status === 'queued' ? 'Waiting to start…' : 'Preparing the export…';
			delay = Math.min(delay * 2, EXPORT_POLL_MAX_MS);
		}
		// Out of time: keep the instance (and its client id) so the person can resume, never fall back.
		this.exportStatus = 'Still preparing — you can resume when it finishes.';
		this.options.toasts.push('The export is taking longer than usual. Resume it when it is ready.');
	}

	private reportExportFailure(err: unknown): void {
		const message = messageOf(err, 'Export failed');
		this.exportError = message;
		this.options.toasts.push(message);
	}

	/**
	 * Handle a failed export call. When the server says the instance is gone (404) or its file has
	 * expired (410), forget both the resume offer and the client id, so the next click mints a fresh
	 * instance instead of retrying a dead one forever. The failure is then reported as usual.
	 */
	private handleExportError(err: unknown, treeId: string, choice: GedcomExportChoice): void {
		if (isExpiredExportError(err)) {
			writePendingExport(null);
			this.pendingExportInstanceId = null;
			this.exportStatus = null;
			clearExportClientUuid(treeId, choice);
		}
		this.reportExportFailure(err);
	}

	selectFile = (e: Event) => {
		const input = e.target as HTMLInputElement;
		if (!input.files || input.files.length === 0) return;
		const file = input.files[0];
		input.value = '';
		this.importFile(file);
	};

	/** Previews a GEDCOM file and asks before importing it, however it was chosen. */
	importFile = (file: File) => {
		this.pendingImportFile = file;
		this.importPreview = null;
		this.importConfirmError = null;
		this.gedzipSessionId = null;
		void this.discardNewTree();
		if (/\.gdz$/i.test(file.name)) void this.openGedzipConfirm(file);
		else void this.openImportConfirm();
	};

	private async openGedzipConfirm(file: File) {
		this.isImportConfirmModalOpen = true;
		let treeId = this.options.treeId() ?? this.gedzipNewTreeId;
		if (!treeId) {
			// An upload belongs to a tree, so a new-tree `.gdz` gets its tree first; the import renames
			// it from the file's own `Tree:` name, as a new-tree `.ged` import does.
			try {
				const name = file.name.replace(/\.gdz$/i, '').trim() || 'Imported Tree';
				treeId = this.gedzipNewTreeId = (await createTreeApi({ name })).id;
			} catch (err) {
				this.importConfirmError = messageOf(err, 'Failed to create tree');
				return;
			}
		}
		this.isLoadingPreview = true;
		this.importConfirmError = null;
		const abort = new AbortController();
		this.uploadAbort = abort;
		this.importUpload = {
			fileName: file.name,
			uploadedBytes: 0,
			totalBytes: file.size,
			phase: 'uploading',
			error: null
		};
		try {
			const uploaded = await startUpload({
				file,
				treeId,
				purpose: 'gedzip_import',
				signal: abort.signal,
				onProgress: (p) => {
					if (this.importUpload) {
						this.importUpload = { ...this.importUpload, uploadedBytes: p.uploadedBytes };
					}
				}
			});
			this.gedzipSessionId = uploaded.sessionId;
			this.importUpload = null;
			this.importPreview = await previewGedzipImport(uploaded.sessionId);
		} catch (err) {
			if (isAbortError(err)) return;
			if (this.importUpload) {
				this.importUpload = {
					...this.importUpload,
					phase: 'failed',
					error: messageOf(err, 'The upload stopped.')
				};
			} else {
				this.importConfirmError = messageOf(err, '');
			}
		} finally {
			this.isLoadingPreview = false;
		}
	}

	retryGedzipUpload = () => {
		if (this.pendingImportFile) void this.openGedzipConfirm(this.pendingImportFile);
	};

	private async openImportConfirm() {
		if (!this.pendingImportFile) return;
		this.isImportConfirmModalOpen = true;
		this.isLoadingPreview = true;
		this.importConfirmError = null;
		try {
			this.importPreview = await previewGedcomImport(this.pendingImportFile, this.options.treeId());
		} catch (err) {
			this.importConfirmError = messageOf(err, '');
		} finally {
			this.isLoadingPreview = false;
		}
	}

	confirmImport = async (
		mode: 'replace' | 'merge',
		options: { shouldMergeDuplicateFamilies: boolean }
	) => {
		if (!this.pendingImportFile) return;
		this.isConfirmingImport = true;
		this.importConfirmError = null;
		this.isImporting = true;
		this.importStatus = 'Importing GEDCOM records into Cloudflare D1...';
		try {
			let result: GedcomImportResult = this.gedzipSessionId
				? await startGedzipImport(this.gedzipSessionId, {
						mode,
						...options,
						isNewTree: this.gedzipNewTreeId !== null
					})
				: await submitGedcomImport(this.pendingImportFile, mode, this.options.treeId(), options);
			// Started: the tree holds (or will hold) the import, so it is no longer ours to discard.
			this.gedzipNewTreeId = null;
			if (result.status === 'queued' && result.jobId) {
				// A large file runs in the background; the dialog stays open on its progress until it ends.
				result = { ...(await this.pollImport(result.jobId)), treeId: result.treeId };
			}
			this.importStatus = `Import complete: ${result.individualsCount || 0} individuals, ${result.familiesCount || 0} families${result.mergedFamiliesCount ? ` (${result.mergedFamiliesCount} duplicate families merged)` : ''}.${result.media ? ` ${describeMediaResult(result.media)}` : ''}`;
			this.isImportConfirmModalOpen = false;
			this.pendingImportFile = null;
			this.importPreview = null;
			await this.options.reload();
			if (result.treeId) this.options.goTo(result.treeId);
		} catch (err) {
			this.importConfirmError =
				err instanceof ApiError && err.status === 409 && this.gedzipSessionId
					? 'This file has already been imported. Close this and choose it again to import it again.'
					: messageOf(err, '');
			this.importStatus = null;
		} finally {
			this.importProgressText = null;
			this.isConfirmingImport = false;
			this.isImporting = false;
		}
	};

	/**
	 * Wait for a queued import to end and answer its counts. A failed job throws its fixed message, so
	 * the dialog shows it the way it shows a refused upload; running out of time throws too, because the
	 * import may still finish and the person should look before importing again.
	 */
	private async pollImport(jobId: string): Promise<GedcomImportResult> {
		let deadline = Date.now() + IMPORT_POLL_TIMEOUT_MS;
		let lastDone = 0;
		let delay = EXPORT_POLL_INITIAL_MS;
		while (Date.now() < deadline) {
			this.importStatus = 'Importing a large file in the background…';
			if (this.gedzipSessionId) this.importProgressText ??= 'Waiting for the import to start…';
			await sleep(delay + Math.random() * EXPORT_POLL_INITIAL_MS);
			const job = await importStatusApi(jobId);
			if (job.status === 'complete') return job.result ?? {};
			if (job.progress) {
				this.importProgressText = `Storing files: ${job.progress.done} of ${job.progress.total} handled.`;
				// A .gdz's media can take longer than the timeout; only a job that stops advancing is given up on.
				if (job.progress.done > lastDone) {
					lastDone = job.progress.done;
					deadline = Date.now() + IMPORT_POLL_TIMEOUT_MS;
				}
			}
			if (job.status === 'failed') throw new Error(job.error || 'The import failed.');
			delay = Math.min(delay * 2, EXPORT_POLL_MAX_MS);
		}
		throw new Error(
			'The import is taking longer than usual. It may still finish; check the tree before importing again.'
		);
	}

	cancelImport = () => {
		this.uploadAbort?.abort();
		this.uploadAbort = null;
		this.importUpload = null;
		this.gedzipSessionId = null;
		this.isImportConfirmModalOpen = false;
		this.pendingImportFile = null;
		this.importPreview = null;
		this.importConfirmError = null;
		void this.discardNewTree();
	};

	/** Deletes a tree made for a `.gdz` whose import never started, so cancelling leaves nothing. */
	private async discardNewTree() {
		const treeId = this.gedzipNewTreeId;
		if (!treeId) return;
		this.gedzipNewTreeId = null;
		await deleteTreeApi(treeId).catch((err: unknown) => {
			console.error('Failed to delete the unused import tree', err);
		});
	}
}
