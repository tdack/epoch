import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import type { FileRowDto } from '#lib/shared/files.js';
import type { TreeEditor } from '#lib/components/tree/tree-editor.svelte.js';

vi.mock('#lib/api/files.js', () => ({
	linkFileApi: vi.fn(),
	unlinkFileApi: vi.fn(),
	fetchFiles: vi.fn(),
	uploadMediaApi: vi.fn()
}));

import { linkFileApi, unlinkFileApi, fetchFiles } from '#lib/api/files.js';
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
