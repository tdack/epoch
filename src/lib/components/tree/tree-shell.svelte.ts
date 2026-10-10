/**
 * The operations on trees as a whole, as opposed to on the people in one: create, rename, delete,
 * import and export. Used by the tree screens' shared header and by the landing page when no tree exists
 * yet, so both offer the same actions with the same dialogs.
 */

import {
	clearExportClientUuid,
	createTreeApi,
	deleteTreeApi,
	exportDownloadUrl,
	exportStatusApi,
	gedcomExportUrl,
	isExpiredExportError,
	renameTreeApi,
	previewGedcomImport,
	startGedcomExport,
	submitGedcomImport,
	type GedcomExportChoice
} from '#lib/services/tree-api.js';
import type { ToastStore } from '#lib/components/feedback/toasts.svelte.js';
import type { ImportPreviewData } from '#lib/types/genealogy.js';

/** How long the client polls a running export before handing the instance back to be resumed. */
const EXPORT_POLL_TIMEOUT_MS = 120_000;
/** The first gap between polls, and the jitter added to each so a fleet of clients does not synchronise. */
const EXPORT_POLL_INITIAL_MS = 1_000;
/** The longest gap between polls. */
const EXPORT_POLL_MAX_MS = 10_000;
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

	// Rename tree
	isRenameTreeModalOpen = $state(false);
	isRenamingTree = $state(false);
	renameTreeError = $state<string | null>(null);

	// Delete tree
	isDeleteTreeModalOpen = $state(false);
	isDeletingTree = $state(false);
	deleteTreeError = $state<string | null>(null);

	// Import
	importStatus = $state<string | null>(null);
	isImporting = $state(false);
	isImportConfirmModalOpen = $state(false);
	pendingImportFile = $state<File | null>(null);
	importPreview = $state<ImportPreviewData | null>(null);
	isLoadingPreview = $state(false);
	isConfirmingImport = $state(false);
	importConfirmError = $state<string | null>(null);

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
		} catch (e: any) {
			console.error('Failed to create tree', e);
			this.createTreeError = e?.message || 'Failed to create tree';
		} finally {
			this.isCreatingTree = false;
		}
	};

	openRenameTree = () => {
		this.renameTreeError = null;
		this.isRenamingTree = false;
		this.isRenameTreeModalOpen = true;
	};

	/** `version` is the tree's as the dialog was opened, so a rename made meanwhile answers 409. */
	renameTree = async (name: string, version: number) => {
		const treeId = this.options.treeId();
		if (!treeId) return;
		this.isRenamingTree = true;
		this.renameTreeError = null;
		try {
			await renameTreeApi(treeId, name, version);
			this.isRenameTreeModalOpen = false;
			this.options.toasts.push('Tree renamed');
			await this.options.reload();
		} catch (err) {
			this.renameTreeError = (err as Error).message || 'Failed to rename tree';
		} finally {
			this.isRenamingTree = false;
		}
	};

	openDeleteTree = () => {
		this.deleteTreeError = null;
		this.isDeletingTree = false;
		this.isDeleteTreeModalOpen = true;
	};

	deleteTree = async () => {
		const treeId = this.options.treeId();
		if (!treeId) return;
		this.isDeletingTree = true;
		this.deleteTreeError = null;
		try {
			await deleteTreeApi(treeId);
			this.isDeleteTreeModalOpen = false;
			this.options.toasts.push('Tree deleted');
			// The landing page opens the next tree, or offers to create one.
			this.options.goTo(null);
		} catch (err: any) {
			this.deleteTreeError = err.message || 'Failed to delete tree';
		} finally {
			this.isDeletingTree = false;
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
		const message = (err as Error)?.message || 'Export failed';
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
		this.pendingImportFile = input.files[0];
		this.importPreview = null;
		this.importConfirmError = null;
		input.value = '';
		void this.openImportConfirm();
	};

	private async openImportConfirm() {
		if (!this.pendingImportFile) return;
		this.isImportConfirmModalOpen = true;
		this.isLoadingPreview = true;
		this.importConfirmError = null;
		try {
			this.importPreview = await previewGedcomImport(this.pendingImportFile, this.options.treeId());
		} catch (err: any) {
			this.importConfirmError = err.message;
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
			const result = await submitGedcomImport(
				this.pendingImportFile,
				mode,
				this.options.treeId(),
				options
			);
			this.importStatus = `Import complete: ${result.individualsCount || 0} individuals, ${result.familiesCount || 0} families${result.mergedFamiliesCount ? ` (${result.mergedFamiliesCount} duplicate families merged)` : ''}.`;
			this.isImportConfirmModalOpen = false;
			this.pendingImportFile = null;
			this.importPreview = null;
			await this.options.reload();
			if (result.treeId) this.options.goTo(result.treeId);
		} catch (err: any) {
			this.importConfirmError = err.message;
			this.importStatus = null;
		} finally {
			this.isConfirmingImport = false;
			this.isImporting = false;
		}
	};

	cancelImport = () => {
		this.isImportConfirmModalOpen = false;
		this.pendingImportFile = null;
		this.importPreview = null;
		this.importConfirmError = null;
	};
}
