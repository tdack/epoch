import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import type { PersonPageDto } from '#lib/shared/person-page.js';
import type { TreeEditor } from '#lib/components/tree/tree-editor.svelte.js';

const toasts = vi.hoisted(() => ({ push: vi.fn() }));

vi.mock('#lib/components/tree/tree-context.js', () => ({
	getTreeContext: () => ({ toasts })
}));
vi.mock('#lib/api/files.js', () => ({
	deleteFileApi: vi.fn(),
	uploadMediaApi: vi.fn()
}));

import { deleteFileApi } from '#lib/api/files.js';
import PersonMedia from './PersonMedia.svelte';

const remove = vi.mocked(deleteFileApi);

let component: Record<string, unknown> | null = null;
beforeEach(() => {
	remove.mockReset();
	toasts.push.mockReset();
});
afterEach(() => {
	if (component) unmount(component);
	component = null;
	document.body.innerHTML = '';
});

const file = (id: string, canDelete: boolean) => ({
	id,
	title: `${id}.pdf`,
	mimeType: 'application/pdf',
	r2ObjectKey: `media/t1/${id}.pdf`,
	canDelete,
	isPrivate: false
});

function render(media: ReturnType<typeof file>[]) {
	const refresh = vi.fn().mockResolvedValue(undefined);
	const dto = { person: { id: 'p1' }, media } as unknown as PersonPageDto;
	component = mount(PersonMedia, {
		target: document.body,
		props: { dto, treeId: 't1', editor: { refresh } as unknown as TreeEditor }
	});
	flushSync();
	return refresh;
}

const button = (name: string) =>
	[...document.querySelectorAll<HTMLButtonElement>('button')].find((b) =>
		b.textContent?.trim().startsWith(name)
	);

describe('PersonMedia delete', () => {
	it('offers Delete only on files the server says the caller may delete', () => {
		render([file('a', true), file('b', false)]);
		const deletes = [...document.querySelectorAll('button')].filter((b) =>
			b.textContent?.includes('Delete')
		);
		expect(deletes).toHaveLength(1);
		expect(deletes[0]!.textContent).toContain('a.pdf');
	});

	it('asks twice, saying the deletion is permanent, and does nothing on Cancel', async () => {
		const refresh = render([file('a', true)]);
		button('Delete')!.click();
		flushSync();
		expect(document.body.textContent).toContain('cannot be undone');
		button('Cancel')!.click();
		flushSync();
		expect(remove).not.toHaveBeenCalled();
		expect(refresh).not.toHaveBeenCalled();
		expect(button('Confirm delete')).toBeUndefined();
	});

	it('deletes the file in its tree, then reloads the screen', async () => {
		remove.mockResolvedValue(undefined);
		const refresh = render([file('a', true)]);
		button('Delete')!.click();
		flushSync();
		button('Confirm delete')!.click();
		await vi.waitFor(() => expect(refresh).toHaveBeenCalled());
		expect(remove).toHaveBeenCalledWith('a', 't1');
	});

	it('reports a refused delete as an error toast and keeps the file listed', async () => {
		remove.mockRejectedValue(new Error('Forbidden'));
		const refresh = render([file('a', true)]);
		button('Delete')!.click();
		flushSync();
		button('Confirm delete')!.click();
		await vi.waitFor(() =>
			expect(toasts.push).toHaveBeenCalledWith('Forbidden', { tone: 'error' })
		);
		expect(refresh).not.toHaveBeenCalled();
		expect(document.querySelectorAll('[aria-label="Attached files"] li')).toHaveLength(1);
	});
});
