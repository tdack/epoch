/**
 * The media section for imported objects (ADR-082): unresolved files, secondary files, fact-level
 * pointers, and the link title and order controls.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import type { MediaFileDto, PersonMediaDto, PersonPageDto } from '#lib/shared/person-page.js';
import type { TreeRole } from '#lib/shared/roles.js';
import type { TreeEditor } from '#lib/components/tree/tree-editor.svelte.js';

const toasts = vi.hoisted(() => ({ push: vi.fn() }));

vi.mock('#lib/components/tree/tree-context.js', () => ({
	getTreeContext: () => ({ toasts })
}));
vi.mock('#lib/api/files.js', () => ({
	deleteFileApi: vi.fn(),
	unlinkFileApi: vi.fn(),
	uploadMediaApi: vi.fn(),
	reorderFilesApi: vi.fn(),
	updateFileLinkTitleApi: vi.fn(),
	resolveFileFromUploadApi: vi.fn()
}));
vi.mock('#lib/api/uploader.js', () => ({ startUpload: vi.fn(), isAbortError: () => false }));

import {
	reorderFilesApi,
	resolveFileFromUploadApi,
	unlinkFileApi,
	updateFileLinkTitleApi
} from '#lib/api/files.js';
import { startUpload } from '#lib/api/uploader.js';
import PersonMedia from './PersonMedia.svelte';

const unlink = vi.mocked(unlinkFileApi);
const reorder = vi.mocked(reorderFilesApi);
const saveTitle = vi.mocked(updateFileLinkTitleApi);
const resolveFile = vi.mocked(resolveFileFromUploadApi);
const send = vi.mocked(startUpload);

let component: Record<string, unknown> | null = null;
beforeEach(() => {
	for (const mock of [unlink, reorder, saveTitle, resolveFile, send]) mock.mockReset();
});
afterEach(() => {
	if (component) unmount(component);
	component = null;
	document.body.innerHTML = '';
});

const entry = (id: string, overrides: Partial<PersonMediaDto> = {}): PersonMediaDto => ({
	id,
	objectId: id,
	objectVersion: 3,
	title: `${id}.pdf`,
	linkTitle: null,
	factId: null,
	factLabel: null,
	mimeType: 'application/pdf',
	r2ObjectKey: `media/t1/${id}.pdf`,
	isUnresolved: false,
	gedcomPath: null,
	extraFiles: [],
	version: 3,
	isShared: false,
	canUnlink: true,
	canDelete: false,
	isPrivate: false,
	...overrides
});

const missing = (id: string, overrides: Partial<PersonMediaDto> = {}) =>
	entry(id, {
		isUnresolved: true,
		r2ObjectKey: null,
		title: null,
		gedcomPath: 'C:\\Photos\\ada-1923.jpg',
		mimeType: 'image/jpeg',
		...overrides
	});

function render(media: PersonMediaDto[], role: TreeRole | undefined = 'editor') {
	const refresh = vi.fn().mockResolvedValue(undefined);
	const mutate = vi.fn(async (run: () => Promise<unknown>) => {
		await run();
		await refresh();
		return true;
	});
	const dto = { person: { id: 'p1' }, media } as unknown as PersonPageDto;
	component = mount(PersonMedia, {
		target: document.body,
		props: { dto, treeId: 't1', editor: { refresh, mutate } as unknown as TreeEditor, role }
	});
	flushSync();
	return refresh;
}

const button = (name: string) =>
	[...document.querySelectorAll<HTMLButtonElement>('button')].find((b) =>
		b.textContent?.trim().startsWith(name)
	);

describe('an unresolved file', () => {
	it('is a missing-file tile with the last path segment and a text badge, and no image or link', () => {
		render([missing('u1')]);
		const tile = document.querySelector('[data-testid="missing-file-tile"]')!;
		expect(tile.textContent).toContain('ada-1923.jpg');
		expect(tile.textContent).toContain('Not stored in Epoch');
		expect(document.querySelector('img')).toBeNull();
		expect(tile.closest('a')).toBeNull();
	});

	it('shows the path as plain text when it is not a web address', () => {
		render([missing('u1')]);
		const path = document.querySelector('[data-testid="file-path"]')!;
		expect(path.textContent).toContain('C:\\Photos\\ada-1923.jpg');
		expect(path.querySelector('a')).toBeNull();
	});

	it('links an http address in a new tab without the opener', () => {
		render([missing('u1', { gedcomPath: 'https://example.org/ada.jpg' })]);
		const link = document.querySelector<HTMLAnchorElement>('[data-testid="file-path"] a')!;
		expect(link.getAttribute('href')).toBe('https://example.org/ada.jpg');
		expect(link.getAttribute('target')).toBe('_blank');
		expect(link.getAttribute('rel')).toBe('noopener noreferrer');
		expect(document.querySelector('img')).toBeNull();
	});

	it('never turns a javascript: or file: path into a link', () => {
		render([
			missing('u1', { gedcomPath: 'javascript:alert(1)' }),
			missing('u2', { gedcomPath: 'file:///C:/a.jpg' })
		]);
		expect(document.querySelectorAll('[data-testid="file-path"] a')).toHaveLength(0);
	});

	it('uploads into the file with "Add file…" and reloads', async () => {
		send.mockResolvedValue({ sessionId: 's1' } as never);
		resolveFile.mockResolvedValue({ change: null });
		const refresh = render([missing('u1')]);
		const input = document.querySelector<HTMLInputElement>('[data-testid="add-file-input"]')!;
		const picked = new File(['x'], 'ada.png', { type: 'image/png' });
		Object.defineProperty(input, 'files', { value: [picked] });
		input.dispatchEvent(new Event('change', { bubbles: true }));
		await vi.waitFor(() => expect(refresh).toHaveBeenCalled());
		expect(send).toHaveBeenCalledWith(
			expect.objectContaining({ file: picked, treeId: 't1', purpose: 'media' })
		);
		expect(resolveFile).toHaveBeenCalledWith({ fileId: 'u1', sessionId: 's1', version: 3 });
	});

	it('offers no "Add file…" to a viewer', () => {
		render([missing('u1')], 'viewer');
		expect(document.querySelector('[data-testid="add-file-input"]')).toBeNull();
	});
});

describe('secondary files and facts', () => {
	const second: MediaFileDto = {
		id: 'b',
		title: 'back.pdf',
		version: 1,
		mimeType: 'application/pdf',
		r2ObjectKey: 'media/t1/b.pdf',
		isUnresolved: false,
		gedcomPath: null
	};

	it('says "+n files" and lists every file in the details', () => {
		render([entry('a', { extraFiles: [second, { ...second, id: 'c' }] })]);
		expect(document.querySelector('summary')!.textContent).toContain('+2 files');
		expect(document.querySelectorAll('[data-testid="object-file"]')).toHaveLength(3);
	});

	it('labels a fact-level pointer and removes it from the fact, not the person', async () => {
		unlink.mockResolvedValue({ change: null });
		const refresh = render([entry('a', { factId: 'e1', factLabel: 'Birth' }), entry('a')]);
		expect(document.querySelector('[data-testid="media-fact-label"]')!.textContent).toBe('Birth');
		const removes = [...document.querySelectorAll('button')].filter((b) =>
			b.textContent?.includes('Remove')
		);
		// Only the fact-level pointer is unlink-only here; the other is the sole use, so it is a delete.
		expect(removes).toHaveLength(1);
		removes[0]!.click();
		flushSync();
		button('Confirm remove')!.click();
		await vi.waitFor(() => expect(refresh).toHaveBeenCalled());
		expect(unlink).toHaveBeenCalledWith('a', 't1', 'p1', 3, 'e1');
	});
});

describe('link title and order', () => {
	it('shows the link title in place of the file title', () => {
		render([entry('a', { linkTitle: 'Wedding day' })]);
		expect(document.querySelector('[data-testid="person-media-item"]')!.textContent).toContain(
			'Wedding day'
		);
	});

	it('saves a title for this person through the object and its version', async () => {
		saveTitle.mockResolvedValue({ change: null });
		render([entry('a')]);
		[...document.querySelectorAll('button')]
			.find((b) => b.textContent?.includes('Edit title'))!
			.click();
		flushSync();
		const input = document.querySelector<HTMLInputElement>(
			'[data-testid="link-title-form"] input'
		)!;
		input.value = 'Wedding';
		input.dispatchEvent(new Event('input', { bubbles: true }));
		button('Save title')!.click();
		await vi.waitFor(() => expect(saveTitle).toHaveBeenCalled());
		expect(saveTitle).toHaveBeenCalledWith({
			fileId: 'a',
			treeId: 't1',
			entityId: 'p1',
			factId: null,
			title: 'Wedding',
			version: 3
		});
	});

	it('moves a file later by sending the whole new order for its host', async () => {
		reorder.mockResolvedValue({ change: null });
		const refresh = render([entry('a'), entry('b'), entry('f', { factId: 'e1' })]);
		const later = [...document.querySelectorAll<HTMLButtonElement>('button')].filter((b) =>
			b.textContent?.includes('later')
		);
		// a is first of the record-level group, b last of it, and the fact's only file last of its own.
		expect(later.map((b) => b.disabled)).toEqual([false, true, true]);
		later[0]!.click();
		await vi.waitFor(() => expect(refresh).toHaveBeenCalled());
		expect(reorder).toHaveBeenCalledWith({
			treeId: 't1',
			entityId: 'p1',
			factId: null,
			orderedMediaIds: ['b', 'a']
		});
	});

	it('orders a fact’s files within that fact', async () => {
		reorder.mockResolvedValue({ change: null });
		const refresh = render([
			entry('a'),
			entry('f1', { factId: 'e1' }),
			entry('f2', { factId: 'e1' })
		]);
		const earlier = [...document.querySelectorAll<HTMLButtonElement>('button')].filter((b) =>
			b.textContent?.includes('earlier')
		);
		expect(earlier.map((b) => b.disabled)).toEqual([true, true, false]);
		earlier[2]!.click();
		await vi.waitFor(() => expect(refresh).toHaveBeenCalled());
		expect(reorder).toHaveBeenCalledWith({
			treeId: 't1',
			entityId: 'p1',
			factId: 'e1',
			orderedMediaIds: ['f2', 'f1']
		});
	});

	it('offers no title or order controls to a viewer', () => {
		render([entry('a')], 'viewer');
		expect(document.body.textContent).not.toContain('Edit title');
	});
});
