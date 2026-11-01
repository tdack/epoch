import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import ImportConfirmModal from './ImportConfirmModal.svelte';
import type { ImportPreviewData } from '#lib/types/genealogy.js';

beforeAll(() => {
	// jsdom has no modal dialog support; opening is all these tests need from it.
	HTMLDialogElement.prototype.showModal = function () {
		this.setAttribute('open', '');
	};
	HTMLDialogElement.prototype.close = function () {
		this.removeAttribute('open');
	};
});

let component: Record<string, unknown> | null = null;
afterEach(() => {
	if (component) unmount(component);
	component = null;
	document.body.innerHTML = '';
});

function preview(retainedTags: ImportPreviewData['retainedTags']): ImportPreviewData {
	return {
		mode: 'replace',
		incoming: { individuals: 2, families: 1, events: 3 },
		duplicates: { exact: [], possible: [] },
		retainedTags
	};
}

function render(data: ImportPreviewData) {
	component = mount(ImportConfirmModal, {
		target: document.body,
		props: {
			isOpen: true,
			hasSelectedTree: false,
			preview: data,
			onclose: () => {},
			onconfirm: () => {}
		}
	});
	flushSync();
}

describe('ImportConfirmModal retained structures', () => {
	it('says what the file keeps as-is, with counts', () => {
		render(
			preview([
				{ tag: 'RESN', count: 12 },
				{ tag: '_CUSTOM', count: 3 }
			])
		);
		const line = [...document.querySelectorAll('p')].find((p) =>
			p.textContent.includes('Kept as-is')
		);
		expect(line?.textContent.replace(/\s+/g, ' ').trim()).toBe(
			'Kept as-is and not editable yet: RESN × 12, _CUSTOM × 3.'
		);
	});

	it('says nothing when no structure is kept', () => {
		render(preview([]));
		expect(document.body.textContent).not.toContain('Kept as-is');
	});
});

describe('ImportConfirmModal unlinked files', () => {
	const existing = (linkedMediaObjectCount?: number): ImportPreviewData => ({
		...preview([]),
		mode: 'merge',
		deleteCounts: { individuals: 4, families: 2, events: 9, childLinks: 3 },
		...(linkedMediaObjectCount !== undefined && { linkedMediaObjectCount }),
		merge: {
			newIndividuals: 0,
			existingIndividuals: 2,
			newFamilies: 0,
			mergedFamilies: 1,
			newChildLinks: 0,
			duplicateChildLinks: 0,
			newEvents: 0,
			duplicateEvents: 0
		}
	});

	function renderExisting(data: ImportPreviewData) {
		component = mount(ImportConfirmModal, {
			target: document.body,
			props: {
				isOpen: true,
				hasSelectedTree: true,
				preview: data,
				onclose: () => {},
				onconfirm: () => {}
			}
		});
		flushSync();
	}

	it('warns how many linked files a replace unlinks, and where they go', () => {
		renderExisting(existing(12));
		expect(document.body.textContent.replace(/\s+/g, ' ')).toContain(
			'12 files are linked to people, families or sources. A replace removes those links; the files stay in Files as unlinked, where you can link them again or delete them.'
		);
	});

	it('says nothing when no file is linked', () => {
		renderExisting(existing());
		expect(document.body.textContent).not.toContain('Files will be unlinked');
	});

	it('says nothing for a new tree', () => {
		render({ ...preview([]), linkedMediaObjectCount: 3 });
		expect(document.body.textContent).not.toContain('Files will be unlinked');
	});
});

describe('ImportConfirmModal for a .gdz', () => {
	const media = {
		entryCount: 4,
		totalBytes: 2048,
		quotaRemainingBytes: 10 * 1024 * 1024,
		resolvableFiles: 2,
		unresolvedFiles: 3,
		extraEntries: 2,
		skippedByType: 1,
		overCap: 0
	};

	it('lists what the archive holds, in words', () => {
		render({ ...preview([]), media });
		const text = document.body.textContent.replace(/\s+/g, ' ');
		expect(text).toContain('Files in this archive');
		expect(text).toContain('4 files to store (2.0 KB); this tree has 10 MB of space left.');
		expect(text).toContain(
			'2 file references will be filled from the archive; 3 will stay without a file'
		);
		expect(text).toContain('2 files that no record mentions will be added to Files, unlinked.');
		expect(text).toContain('1 skipped because Epoch does not accept that type of file.');
		expect(text).not.toContain('over 500');
	});

	it('keeps the unlink notice for a replace', () => {
		component = mount(ImportConfirmModal, {
			target: document.body,
			props: {
				isOpen: true,
				hasSelectedTree: true,
				preview: {
					...preview([]),
					media,
					linkedMediaObjectCount: 3,
					deleteCounts: { individuals: 1, families: 1, events: 1, childLinks: 0 }
				},
				onclose: () => {},
				onconfirm: () => {}
			}
		});
		flushSync();
		expect(document.body.textContent).toContain('Files will be unlinked');
	});

	it('shows upload progress with text, then the import progress line', () => {
		component = mount(ImportConfirmModal, {
			target: document.body,
			props: {
				isOpen: true,
				hasSelectedTree: true,
				preview: null,
				isLoadingPreview: true,
				upload: {
					fileName: 'a.gdz',
					uploadedBytes: 1024,
					totalBytes: 2048,
					phase: 'uploading',
					error: null
				},
				onclose: () => {},
				onconfirm: () => {}
			}
		});
		flushSync();
		expect(document.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe(
			'50'
		);
		expect(document.body.textContent).toContain('1.0 KB of 2.0 KB');
		unmount(component);
		component = mount(ImportConfirmModal, {
			target: document.body,
			props: {
				isOpen: true,
				hasSelectedTree: true,
				preview: { ...preview([]), media },
				isConfirming: true,
				progressText: 'Storing files: 100 of 250 handled.',
				onclose: () => {},
				onconfirm: () => {}
			}
		});
		flushSync();
		expect(document.querySelector('[role="status"]')?.textContent.trim()).toBe(
			'Storing files: 100 of 250 handled.'
		);
	});
});
