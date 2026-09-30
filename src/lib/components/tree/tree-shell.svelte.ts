/**
 * The operations on trees as a whole, as opposed to on the people in one: create, delete, import
 * and export. Used by the tree screens' shared header and by the landing page when no tree exists
 * yet, so both offer the same actions with the same dialogs.
 */

import {
	createTreeApi,
	deleteTreeApi,
	previewGedcomImport,
	submitGedcomImport
} from '#lib/services/tree-api.js';
import type { ToastStore } from '#lib/components/feedback/toasts.svelte.js';
import type { ImportPreviewData } from '#lib/types/genealogy.js';

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
	showNewTreeModal = $state(false);
	isCreatingTree = $state(false);
	createTreeError = $state<string | null>(null);

	// Delete tree
	showDeleteTreeModal = $state(false);
	isDeletingTree = $state(false);
	deleteTreeError = $state<string | null>(null);

	// Import
	importStatus = $state<string | null>(null);
	isImporting = $state(false);
	showImportConfirmModal = $state(false);
	pendingImportFile = $state<File | null>(null);
	importPreview = $state<ImportPreviewData | null>(null);
	isLoadingPreview = $state(false);
	isConfirmingImport = $state(false);
	importConfirmError = $state<string | null>(null);

	constructor(private options: TreeShellOptions) {}

	openNewTree = () => {
		this.createTreeError = null;
		this.isCreatingTree = false;
		this.showNewTreeModal = true;
	};

	createTree = async (data: { name: string; description?: string }) => {
		this.createTreeError = null;
		this.isCreatingTree = true;
		try {
			const created = await createTreeApi(data);
			this.showNewTreeModal = false;
			await this.options.reload();
			if (created?.id) this.options.goTo(created.id);
		} catch (e: any) {
			console.error('Failed to create tree', e);
			this.createTreeError = e?.message || 'Failed to create tree';
		} finally {
			this.isCreatingTree = false;
		}
	};

	openDeleteTree = () => {
		this.deleteTreeError = null;
		this.isDeletingTree = false;
		this.showDeleteTreeModal = true;
	};

	deleteTree = async () => {
		const treeId = this.options.treeId();
		if (!treeId) return;
		this.isDeletingTree = true;
		this.deleteTreeError = null;
		try {
			await deleteTreeApi(treeId);
			this.showDeleteTreeModal = false;
			this.options.toasts.push('Tree deleted');
			// The landing page opens the next tree, or offers to create one.
			this.options.goTo(null);
		} catch (err: any) {
			this.deleteTreeError = err.message || 'Failed to delete tree';
		} finally {
			this.isDeletingTree = false;
		}
	};

	exportGedcom = () => {
		const treeId = this.options.treeId();
		if (treeId) window.location.href = `/api/export?treeId=${encodeURIComponent(treeId)}`;
	};

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
		this.showImportConfirmModal = true;
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

	confirmImport = async (mode: 'replace' | 'merge', options: { shouldMergeDuplicateFamilies: boolean }) => {
		if (!this.pendingImportFile) return;
		this.isConfirmingImport = true;
		this.importConfirmError = null;
		this.isImporting = true;
		this.importStatus = 'Importing GEDCOM records into Cloudflare D1...';
		try {
			const result = await submitGedcomImport(this.pendingImportFile, mode, this.options.treeId(), options);
			this.importStatus = `Import complete: ${result.individualsCount || 0} individuals, ${result.familiesCount || 0} families${result.mergedFamiliesCount ? ` (${result.mergedFamiliesCount} duplicate families merged)` : ''}.`;
			this.showImportConfirmModal = false;
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
		this.showImportConfirmModal = false;
		this.pendingImportFile = null;
		this.importPreview = null;
		this.importConfirmError = null;
	};
}
