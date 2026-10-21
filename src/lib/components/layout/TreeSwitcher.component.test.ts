import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import TreeSwitcher from './TreeSwitcher.svelte';
import type { TreeSummary } from '#lib/types/genealogy.js';

let component: Record<string, unknown> | null = null;
afterEach(() => {
	if (component) unmount(component);
	component = null;
	document.body.innerHTML = '';
});

const trees = [
	{ id: 'a', name: 'Alpha' },
	{ id: 'b', name: 'Beta' },
	{ id: 'c', name: 'Gamma' }
] as TreeSummary[];

function render(
	selectedTreeId: string,
	extra: {
		subtrees?: { id: string; slug: string; name: string; rootPersonId: string }[];
		activeSubtreeId?: string | null;
		onselectTree?: (id: string) => void;
		onselectSubtree?: (subtree: { id: string }) => void;
	} = {}
) {
	component = mount(TreeSwitcher, {
		target: document.body,
		props: {
			trees,
			selectedTreeId,
			onselectTree: () => {},
			onopenNewTree: () => {},
			onfileSelect: () => {},
			...extra
		}
	});
	flushSync();
	return document.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')!;
}

describe('TreeSwitcher', () => {
	it('opens on the checked tree rather than the first item', async () => {
		render('b');
		document.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')!.click();
		flushSync();
		await vi.waitFor(() =>
			expect(document.activeElement?.getAttribute('aria-checked')).toBe('true')
		);
		expect(document.activeElement?.textContent).toContain('Beta');
	});

	it('ArrowUp still opens on the last item', async () => {
		const trigger = render('b');
		trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
		flushSync();
		await vi.waitFor(() => expect(document.querySelector('[role="menu"]')).not.toBeNull());
		const items = [...document.querySelectorAll('[role^="menuitem"]')];
		await vi.waitFor(() => expect(document.activeElement).toBe(items[items.length - 1]));
	});

	it('returns focus to the trigger after choosing a tree', async () => {
		const trigger = render('a');
		trigger.click();
		flushSync();
		const beta = [...document.querySelectorAll<HTMLElement>('[role="menuitemradio"]')][1];
		await vi.waitFor(() => expect(document.activeElement).not.toBe(document.body));
		beta.click();
		flushSync();
		expect(document.activeElement).toBe(trigger);
	});

	describe('sub-trees', () => {
		const subtrees = [
			{ id: 's1', slug: 'x', name: 'Simpson line', rootPersonId: 'p1' },
			{ id: 's2', slug: 'y', name: 'Flanders line', rootPersonId: 'p2' }
		];
		const radios = () => [...document.querySelectorAll<HTMLElement>('[role="menuitemradio"]')];

		it('lists them indented under the current tree only, the tree still selectable', () => {
			const onselectTree = vi.fn();
			const onselectSubtree = vi.fn();
			render('b', { subtrees, onselectTree, onselectSubtree }).click();
			flushSync();
			expect(radios().map((r) => r.textContent?.trim())).toEqual([
				'Alpha',
				'Beta',
				'Simpson line',
				'Flanders line',
				'Gamma'
			]);
			// Whole tree is checked while no lens is active.
			expect(radios().map((r) => r.getAttribute('aria-checked'))).toEqual([
				'false',
				'true',
				'false',
				'false',
				'false'
			]);
			radios()[3].click();
			expect(onselectSubtree).toHaveBeenCalledWith(subtrees[1]);
		});

		it('checks the active sub-tree instead of its tree, and the tree entry leaves the lens', () => {
			const onselectTree = vi.fn();
			render('b', { subtrees, activeSubtreeId: 's1', onselectTree }).click();
			flushSync();
			expect(radios().map((r) => r.getAttribute('aria-checked'))).toEqual([
				'false',
				'false',
				'true',
				'false',
				'false'
			]);
			radios()[1].click();
			expect(onselectTree).toHaveBeenCalledWith('b');
		});
	});
});
