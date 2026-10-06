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

function render(selectedTreeId: string) {
	component = mount(TreeSwitcher, {
		target: document.body,
		props: {
			trees,
			selectedTreeId,
			onselectTree: () => {},
			onopenNewTree: () => {},
			onopenDeleteTree: () => {},
			onfileSelect: () => {},
			onexportGedcom: () => {}
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
});
