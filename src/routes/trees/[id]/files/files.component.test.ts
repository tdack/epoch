import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import type { FileRowDto } from '#lib/shared/files.js';

const toasts = vi.hoisted(() => ({ push: vi.fn() }));

vi.mock('#lib/components/tree/tree-context.js', () => ({
	getTreeContext: () => ({ toasts })
}));
vi.mock('#lib/components/PersonPicker.svelte', () => ({ default: function () {} }));
vi.mock('#lib/api/evidence.js', () => ({ fetchSources: vi.fn(), createSourceApi: vi.fn() }));
vi.mock('#lib/api/files.js', () => ({
	attachFileApi: vi.fn(),
	deleteFileApi: vi.fn(),
	deleteUnlinkedFilesApi: vi.fn(),
	detachFileApi: vi.fn(),
	fetchFiles: vi.fn(),
	fetchFileUsage: vi.fn(),
	fetchUnlinkedFiles: vi.fn(),
	moveFileApi: vi.fn(),
	renameFileApi: vi.fn(),
	uploadMediaApi: vi.fn()
}));

import {
	attachFileApi,
	deleteFileApi,
	fetchFiles,
	fetchFileUsage,
	fetchUnlinkedFiles,
	moveFileApi
} from '#lib/api/files.js';
import { fetchSources } from '#lib/api/evidence.js';
import Page from './+page.svelte';

const remove = vi.mocked(deleteFileApi);
const attach = vi.mocked(attachFileApi);
const move = vi.mocked(moveFileApi);
const sources = vi.mocked(fetchSources);
const listFiles = vi.mocked(fetchFiles);
const usage = vi.mocked(fetchFileUsage);
const unlinked = vi.mocked(fetchUnlinkedFiles);

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
beforeEach(() => {
	toasts.push.mockReset();
	remove.mockReset();
	attach.mockReset();
	move.mockReset();
	sources.mockReset();
	listFiles.mockReset();
	usage.mockResolvedValue({ trees: [], installBytes: null });
	unlinked.mockReset();
});
afterEach(() => {
	if (component) unmount(component);
	component = null;
	document.body.innerHTML = '';
});

const TREE = { id: 't1', name: 'Tree One', slug: 'tree-one' };

/** A file row as the server sends it, with every action off unless a test turns it on. */
function row(overrides: Partial<FileRowDto>): FileRowDto {
	return {
		id: 'f1',
		title: 'Certificate.pdf',
		mimeType: 'application/pdf',
		sizeBytes: 2048,
		treeId: 't1',
		treeName: 'Tree One',
		attachedTo: 'Ada Lovelace',
		uploadedBy: null,
		createdAt: Date.UTC(2026, 0, 2),
		previewKey: 'media/t1/f1.pdf',
		canPreview: true,
		canRename: false,
		canAttach: false,
		canDetach: false,
		canMove: false,
		canDelete: false,
		...overrides
	};
}

function render(options: {
	role: 'owner' | 'manager' | 'editor' | 'contributor' | 'viewer';
	files: FileRowDto[];
	nextCursor?: string | null;
}) {
	const data = {
		summary: { tree: TREE, viewer: { isPublicVisitor: false, isOutsider: false } },
		trees: [{ ...TREE, role: options.role }],
		files: { files: options.files, nextCursor: options.nextCursor ?? null },
		usage: { trees: [], installBytes: null }
	};
	component = mount(Page, {
		target: document.body,
		props: { data, params: { id: 't1' } } as never
	});
	flushSync();
}

function unmountAll() {
	if (component) unmount(component);
	component = null;
	document.body.innerHTML = '';
}

const actions = () =>
	[...document.querySelectorAll('tbody button')].map((b) => b.textContent?.trim());

describe('Files page visibility', () => {
	it('shows an owner every action the server allows on each row', () => {
		render({
			role: 'owner',
			files: [
				row({
					canRename: true,
					canAttach: false,
					canDetach: true,
					canMove: true,
					canDelete: true
				})
			]
		});
		expect(actions()).toEqual([
			'Preview Certificate.pdf',
			'Rename Certificate.pdf',
			'Move Certificate.pdf',
			'Detach Certificate.pdf',
			'Delete Certificate.pdf'
		]);
	});

	it('offers a viewer no action on any row, only the details', () => {
		render({
			role: 'viewer',
			files: [row({ canPreview: true })]
		});
		expect(actions()).toEqual(['Preview Certificate.pdf']);
		expect(document.querySelector('[data-testid="files-add"]')).toBeNull();
		expect(document.body.textContent).not.toContain('Stored files with no record');
	});

	it('shows a detached row only with Attach when the server allows it', () => {
		render({
			role: 'editor',
			files: [
				row({
					attachedTo: null,
					canPreview: true,
					canRename: true,
					canAttach: true,
					canDelete: true
				})
			]
		});
		expect(actions()).toContain('Attach Certificate.pdf');
		expect(actions()).not.toContain('Detach Certificate.pdf');
		expect(document.body.textContent).toContain('Not attached');
	});

	it('shows metadata only, with no actions, for a row the caller cannot open', () => {
		render({
			role: 'owner',
			files: [row({ canPreview: false, previewKey: null })]
		});
		expect(actions()).toEqual([]);
		expect(document.body.textContent).toContain('Details only');
	});

	it('offers adding a file to an editor, but not to a contributor', () => {
		render({ role: 'editor', files: [] });
		expect(document.querySelector('[data-testid="files-add"]')).not.toBeNull();
		unmountAll();
		document.body.innerHTML = '';
		render({ role: 'contributor', files: [] });
		expect(document.querySelector('[data-testid="files-add"]')).toBeNull();
	});

	it('shows the stored-files check to a manager, not to an editor', () => {
		render({ role: 'manager', files: [] });
		expect(document.body.textContent).toContain('Stored files with no record');
		unmountAll();
		document.body.innerHTML = '';
		render({ role: 'editor', files: [] });
		expect(document.body.textContent).not.toContain('Stored files with no record');
	});

	it('shows the uploader column only when a row names one', () => {
		render({ role: 'manager', files: [row({ uploadedBy: null })] });
		expect(document.querySelector('th[scope="col"]')!.textContent).not.toContain('Uploaded by');
		expect([...document.querySelectorAll('th')].map((h) => h.textContent?.trim())).not.toContain(
			'Uploaded by'
		);
		unmountAll();
		document.body.innerHTML = '';
		render({ role: 'manager', files: [row({ uploadedBy: 'Sam' })] });
		expect([...document.querySelectorAll('th')].map((h) => h.textContent?.trim())).toContain(
			'Uploaded by'
		);
	});

	it('shows Unknown for a file with no recorded size', () => {
		render({ role: 'owner', files: [row({ sizeBytes: null })] });
		expect(document.querySelector('tbody tr td:nth-child(4)')!.textContent).toContain('Unknown');
	});
});

describe('Files page delete', () => {
	it('says the deletion is permanent, and deletes only after the confirm button', async () => {
		remove.mockResolvedValue(undefined);
		render({
			role: 'owner',
			files: [row({ canDelete: true })]
		});
		const deleteButton = [...document.querySelectorAll<HTMLButtonElement>('tbody button')].find(
			(b) => b.textContent?.includes('Delete Certificate.pdf')
		)!;
		deleteButton.click();
		flushSync();
		expect(document.body.textContent).toContain('cannot be undone');
		expect(remove).not.toHaveBeenCalled();
		const confirm = [...document.querySelectorAll<HTMLButtonElement>('button')].find(
			(b) => b.textContent?.trim() === 'Delete permanently'
		)!;
		listFiles.mockResolvedValue({ files: [], nextCursor: null });
		confirm.click();
		await vi.waitFor(() => expect(remove).toHaveBeenCalledWith('f1', 't1'));
	});
});

describe('Files page paging', () => {
	it('offers more files while a cursor is left, and appends the next page', async () => {
		render({
			role: 'owner',
			files: [row({ id: 'f1', title: 'First.pdf' })],
			nextCursor: 'c1'
		});
		listFiles.mockResolvedValue({
			files: [row({ id: 'f2', title: 'Second.pdf' })],
			nextCursor: null
		});
		[...document.querySelectorAll<HTMLButtonElement>('button')]
			.find((b) => b.textContent?.trim() === 'Load more files')!
			.click();
		await vi.waitFor(() => expect(document.body.textContent).toContain('Second.pdf'));
		expect(listFiles).toHaveBeenCalledWith({ treeId: 't1', cursor: 'c1' });
		expect(document.querySelectorAll('[data-testid="file-row"]')).toHaveLength(2);
	});

	it('keeps loading past an empty page until one has files', async () => {
		render({ role: 'viewer', files: [], nextCursor: 'c1' });
		listFiles
			.mockResolvedValueOnce({ files: [], nextCursor: 'c2' })
			.mockResolvedValueOnce({ files: [row({ id: 'f9', title: 'Found.pdf' })], nextCursor: null });
		[...document.querySelectorAll<HTMLButtonElement>('button')]
			.find((b) => b.textContent?.trim() === 'Load more files')!
			.click();
		await vi.waitFor(() => expect(document.body.textContent).toContain('Found.pdf'));
		expect(listFiles).toHaveBeenCalledTimes(2);
		expect(listFiles).toHaveBeenLastCalledWith({ treeId: 't1', cursor: 'c2' });
	});
});

describe('Files page attach and move to a source', () => {
	const click = (name: string) =>
		[...document.querySelectorAll<HTMLButtonElement>('button')]
			.find((b) => b.textContent?.trim() === name)!
			.click();

	async function pickSource() {
		sources.mockResolvedValue({
			items: [{ id: 's1', title: 'Parish register', author: null }]
		} as never);
		click('Source');
		flushSync();
		await vi.waitFor(() => expect(document.querySelector('[role="option"]')).not.toBeNull());
		document.querySelector<HTMLElement>('[role="option"]')!.click();
		flushSync();
	}

	it('attaches a detached file to the source chosen', async () => {
		attach.mockResolvedValue({ change: null });
		listFiles.mockResolvedValue({ files: [], nextCursor: null });
		render({ role: 'editor', files: [row({ attachedTo: null, canAttach: true })] });
		click('Attach Certificate.pdf');
		flushSync();
		await pickSource();
		click('Attach');
		await vi.waitFor(() => expect(attach).toHaveBeenCalledWith('f1', 't1', 's1', undefined));
	});

	it('moves an attached file to the source chosen', async () => {
		move.mockResolvedValue(undefined);
		listFiles.mockResolvedValue({ files: [], nextCursor: null });
		render({ role: 'editor', files: [row({ canMove: true })] });
		click('Move Certificate.pdf');
		flushSync();
		await pickSource();
		click('Move here');
		await vi.waitFor(() => expect(move).toHaveBeenCalledWith('f1', 't1', 's1', undefined));
	});

	it('offers no source to a role that cannot change evidence', () => {
		render({ role: 'contributor', files: [row({ attachedTo: null, canAttach: true })] });
		click('Attach Certificate.pdf');
		flushSync();
		expect(
			[...document.querySelectorAll('button')].some((b) => b.textContent?.trim() === 'Source')
		).toBe(false);
	});
});
