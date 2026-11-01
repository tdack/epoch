import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import type { FileRowDto } from '#lib/shared/files.js';
import type { TreeEditor } from '#lib/components/tree/tree-editor.svelte.js';

vi.mock('#lib/api/files.js', () => ({
	linkFileApi: vi.fn(),
	unlinkFileApi: vi.fn(),
	fetchFiles: vi.fn(),
	mediaFromUploadApi: vi.fn(),
	reorderFilesApi: vi.fn(),
	updateFileLinkTitleApi: vi.fn(),
	resolveFileFromUploadApi: vi.fn()
}));
vi.mock('#lib/api/uploader.js', () => ({ startUpload: vi.fn(), isAbortError: () => false }));

import {
	linkFileApi,
	unlinkFileApi,
	fetchFiles,
	reorderFilesApi,
	updateFileLinkTitleApi
} from '#lib/api/files.js';
import SourceFiles from './SourceFiles.svelte';

const detachApi = vi.mocked(unlinkFileApi);
const attachApi = vi.mocked(linkFileApi);
const listApi = vi.mocked(fetchFiles);

let component: Record<string, unknown> | null = null;
beforeEach(() => {
	detachApi.mockReset();
	attachApi.mockReset();
	listApi.mockReset();
});
afterEach(() => {
	if (component) unmount(component);
	component = null;
	document.body.innerHTML = '';
});

const file = (id: string, overrides: Partial<FileRowDto> = {}): FileRowDto => ({
	id,
	objectId: id,
	objectVersion: 1,
	isUnresolved: false,
	gedcomPath: null,
	extraFiles: [],
	hostLink: null,
	title: `${id}.png`,
	version: 1,
	mimeType: 'image/png',
	sizeBytes: 2048,
	treeId: 't1',
	treeName: 'Tree',
	links: [{ entityId: 's1', kind: 'source', label: 'Census 1851', href: '/trees/t1/sources/s1' }],
	uploadedBy: null,
	createdAt: 0,
	previewKey: `media/t1/${id}.png`,
	canPreview: true,
	canRename: true,
	canLink: true,
	canDelete: false,
	...overrides
});

function render(files: FileRowDto[], canManage: boolean) {
	const mutate = vi.fn(async (run: () => Promise<unknown>) => {
		await run();
		return true;
	});
	component = mount(SourceFiles, {
		target: document.body,
		props: {
			treeId: 't1',
			sourceId: 's1',
			files,
			canManage,
			editor: { mutate, refresh: vi.fn() } as unknown as TreeEditor
		}
	});
	flushSync();
	return mutate;
}

const button = (name: string) =>
	[...document.querySelectorAll<HTMLButtonElement>('button')].find((b) =>
		b.textContent?.trim().startsWith(name)
	);

describe('SourceFiles', () => {
	it('lists the files with their names and a count', () => {
		render([file('a'), file('b')], true);
		expect(document.querySelector('h3')?.textContent).toContain('2');
		expect([...document.querySelectorAll('[data-testid="source-file"] img')]).toHaveLength(2);
	});

	it('is read-only for a viewer: no upload, attach or detach', () => {
		render([file('a', { canLink: false })], false);
		expect(button('Attach existing')).toBeUndefined();
		expect(button('Detach')).toBeUndefined();
		expect(document.querySelector('input[type="file"]')).toBeNull();
	});

	it('detaches only where the server allows it, in this tree', async () => {
		const mutate = render([file('a'), file('b', { canLink: false })], true);
		const detaches = [...document.querySelectorAll('button')].filter((b) =>
			b.textContent?.includes('Detach')
		);
		expect(detaches).toHaveLength(1);
		detaches[0]!.click();
		await vi.waitFor(() => expect(detachApi).toHaveBeenCalledWith('a', 't1', 's1', undefined));
		expect(mutate).toHaveBeenCalledOnce();
	});

	it('lists unattached files and attaches the chosen one to this source', async () => {
		listApi.mockResolvedValue({
			files: [file('loose', { links: [], canLink: true })],
			nextCursor: null
		});
		render([], true);
		button('Attach existing')!.click();
		await vi.waitFor(() =>
			expect(document.querySelector('[data-testid="attach-picker"]')).not.toBeNull()
		);
		expect(listApi).toHaveBeenCalledWith({ treeId: 't1', isDetachedOnly: true, limit: 100 });
		document.querySelector<HTMLButtonElement>('[aria-label^="Attach loose"]')!.click();
		await vi.waitFor(() => expect(attachApi).toHaveBeenCalledWith('loose', 't1', 's1', undefined));
	});
});

describe('SourceFiles imported objects', () => {
	const reorder = vi.mocked(reorderFilesApi);
	const retitle = vi.mocked(updateFileLinkTitleApi);
	const missing = (id: string, overrides: Partial<FileRowDto> = {}) =>
		file(id, {
			isUnresolved: true,
			previewKey: null,
			canPreview: false,
			sizeBytes: null,
			title: null,
			gedcomPath: 'https://example.org/register.pdf',
			mimeType: 'application/pdf',
			...overrides
		});

	it('shows an unresolved file as a missing-file tile: badge, path link, no image', () => {
		render([missing('u1')], true);
		const item = document.querySelector('[data-testid="source-file"]')!;
		expect(item.textContent).toContain('Not stored in Epoch');
		expect(item.textContent).toContain('register.pdf');
		expect(item.querySelector('img')).toBeNull();
		expect(item.querySelector('[data-testid="missing-file-tile"]')!.closest('a')).toBeNull();
		const link = item.querySelector<HTMLAnchorElement>('[data-testid="file-path"] a')!;
		expect(link.getAttribute('rel')).toBe('noopener noreferrer');
		expect(link.getAttribute('target')).toBe('_blank');
	});

	it('keeps a Windows path as text', () => {
		render([missing('u1', { gedcomPath: 'C:\\Scans\\register.pdf' })], false);
		const path = document.querySelector('[data-testid="file-path"]')!;
		expect(path.querySelector('a')).toBeNull();
		expect(path.textContent).toContain('C:\\Scans\\register.pdf');
	});

	it('says "+n files" and lists the object’s other files', () => {
		const extra = (id: string) => ({
			id,
			title: `${id}.png`,
			version: 1,
			mimeType: 'image/png',
			sizeBytes: 5,
			isUnresolved: false,
			gedcomPath: null,
			previewKey: `media/t1/${id}.png`
		});
		render([file('a', { extraFiles: [extra('b'), extra('c')] })], false);
		expect(document.querySelector('summary')!.textContent).toContain('+2 files');
		expect(document.querySelectorAll('[data-testid="object-file"]')).toHaveLength(3);
	});

	it('orders by the source’s pointer order and shows its title in place of the file’s', () => {
		render(
			[
				file('a', { hostLink: { title: null, sortOrder: 1 } }),
				file('b', { hostLink: { title: 'Front page', sortOrder: 0 } })
			],
			false
		);
		const names = [...document.querySelectorAll('[data-testid="source-file"] > span')].map((n) =>
			n.textContent?.trim()
		);
		expect(names).toEqual(['Front page', 'a.png']);
	});

	it('saves a title and moves a file for this source', async () => {
		retitle.mockResolvedValue({ change: null });
		reorder.mockResolvedValue({ change: null });
		render([file('a'), file('b')], true);
		const later = [...document.querySelectorAll<HTMLButtonElement>('button')].filter((b) =>
			b.textContent?.includes('later')
		);
		later[0]!.click();
		await vi.waitFor(() =>
			expect(reorder).toHaveBeenCalledWith({
				treeId: 't1',
				entityId: 's1',
				factId: null,
				orderedMediaIds: ['b', 'a']
			})
		);
		[...document.querySelectorAll('button')]
			.find((b) => b.textContent?.includes('Edit title'))!
			.click();
		flushSync();
		const input = document.querySelector<HTMLInputElement>(
			'[data-testid="link-title-form"] input'
		)!;
		input.value = 'Cover';
		input.dispatchEvent(new Event('input', { bubbles: true }));
		button('Save title')!.click();
		await vi.waitFor(() =>
			expect(retitle).toHaveBeenCalledWith({
				fileId: 'a',
				treeId: 't1',
				entityId: 's1',
				factId: null,
				title: 'Cover',
				version: 1
			})
		);
	});
});
