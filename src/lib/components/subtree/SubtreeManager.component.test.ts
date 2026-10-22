import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import SubtreeManager from './SubtreeManager.svelte';
import type { SubtreeDto } from '#lib/shared/subtrees.js';

const api = vi.hoisted(() => ({
	updateSubtree: vi.fn(),
	deleteSubtree: vi.fn(),
	reorderSubtrees: vi.fn()
}));
vi.mock('#lib/api/subtrees.js', () => api);
vi.mock('#lib/api/relationships.js', () => ({ undoApi: vi.fn() }));
vi.mock('#lib/api/lists.js', () => ({ searchPeopleApi: vi.fn().mockResolvedValue([]) }));

beforeAll(() => {
	HTMLDialogElement.prototype.showModal = function () {
		this.setAttribute('open', '');
	};
	HTMLDialogElement.prototype.close = function () {
		this.removeAttribute('open');
	};
});

let component: Record<string, unknown> | null = null;
beforeEach(() => {
	api.updateSubtree.mockReset().mockResolvedValue({ change: null });
	api.reorderSubtrees.mockReset().mockResolvedValue({ change: null });
	api.deleteSubtree
		.mockReset()
		.mockResolvedValue({ change: { summary: 'Deleted sub-tree', isUndoable: true } });
});
afterEach(() => {
	if (component) unmount(component);
	component = null;
	document.body.innerHTML = '';
});

const sub = (id: string, position: number, extra: Partial<SubtreeDto> = {}): SubtreeDto => ({
	id,
	slug: id,
	name: `Line ${id}`,
	rootPersonId: `p-${id}`,
	position,
	version: 3,
	isPublic: false,
	isRootMissing: false,
	...extra
});

function render(canManage = true, subtrees = [sub('a', 0), sub('b', 5, { isRootMissing: true })]) {
	const toasts = { push: vi.fn() };
	const onchanged = vi.fn();
	component = mount(SubtreeManager, {
		target: document.body,
		props: {
			tree: { id: 't', slug: 'tree' },
			subtrees,
			rootNames: { 'p-a': 'Ann Line' },
			canManage,
			toasts: toasts as never,
			onchanged
		}
	});
	flushSync();
	return { toasts, onchanged };
}

const button = (text: RegExp) =>
	[...document.querySelectorAll('button')].find((b) => text.test(b.textContent ?? ''))!;
const settle = () => new Promise((r) => setTimeout(r, 0));

describe('SubtreeManager', () => {
	it('lists roots and marks a missing one', () => {
		render();
		expect(document.body.textContent).toContain('Anchored at Ann Line');
		expect(document.body.textContent).toContain('Anchor missing');
	});

	it('is read-only below manager', () => {
		render(false);
		expect(document.body.textContent).toContain('Line a');
		expect(button(/Delete/)).toBeUndefined();
	});

	it('reorders from the handle by keyboard with one write and no Undo offer', async () => {
		const { toasts, onchanged } = render();
		const handle = document.querySelector<HTMLButtonElement>('[aria-label="Reorder Line a"]')!;
		handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
		await settle();
		expect(api.reorderSubtrees).toHaveBeenCalledTimes(1);
		expect(api.reorderSubtrees).toHaveBeenCalledWith('t', {
			order: [
				{ id: 'b', version: 3 },
				{ id: 'a', version: 3 }
			]
		});
		expect(onchanged).toHaveBeenCalled();
		expect(toasts.push).not.toHaveBeenCalled();
		expect(document.body.textContent).toContain('Line a moved to position 2 of 2');
	});

	it('reports a refused reorder in a toast', async () => {
		api.reorderSubtrees.mockRejectedValue(new Error('Changed by someone else'));
		const { toasts } = render();
		document
			.querySelector('[aria-label="Reorder Line a"]')!
			.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
		await settle();
		expect(toasts.push).toHaveBeenCalledWith('Changed by someone else', { tone: 'error' });
	});

	it('has no handle below manager', () => {
		render(false);
		expect(document.querySelector('[aria-label^="Reorder"]')).toBeNull();
	});

	it('deletes after confirmation and offers Undo', async () => {
		const { toasts } = render();
		button(/^\s*Delete\s*Line a/).click();
		flushSync();
		document.querySelector<HTMLButtonElement>('[data-testid="confirm-delete-subtree"]')!.click();
		await settle();
		expect(api.deleteSubtree).toHaveBeenCalledWith('t', 'a', 3);
		const [message, options] = toasts.push.mock.calls[0]!;
		expect(message).toBe('Deleted sub-tree');
		expect(options.action.label).toBe('Undo');
	});
});
