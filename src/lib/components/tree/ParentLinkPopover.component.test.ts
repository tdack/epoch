import { afterEach, describe, expect, it, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import ParentLinkPopover from './ParentLinkPopover.svelte';
import type { ChildEdge } from '#lib/tree-layout/index.js';

// The project's ambient worker types clash with lib.dom's HTMLSelectElement; only these members are used.
interface SelectLike {
	options: Iterable<{ value: string }>;
	value: string;
	dispatchEvent(event: Event): boolean;
}

let component: Record<string, unknown> | null = null;
afterEach(() => {
	if (component) unmount(component);
	component = null;
	document.body.innerHTML = '';
});

const edge = {
	id: 'e1',
	kind: 'child',
	childId: 'c',
	unionId: 'u',
	assertions: [
		{ parentId: 'a', type: 'biological' },
		{ parentId: 'b', type: 'adoptive' }
	]
} as unknown as ChildEdge;

function render(overrides: Record<string, unknown> = {}) {
	const props = { edge, childName: 'Cal', nameOf: (id: string) => ({ a: 'Ann', b: 'Ben' })[id] ?? id, x: 0, y: 0, onRemove: vi.fn(), onChangeType: vi.fn(), onClose: vi.fn(), ...overrides };
	component = mount(ParentLinkPopover, { target: document.body, props });
	// bind:this and onMount run in effects; flush them the way the browser's microtask would.
	flushSync();
	return props;
}

describe('ParentLinkPopover', () => {
	it('is a labelled modal dialog with one row per parent, so a screen reader hears who and which type', () => {
		render();
		const dialog = document.querySelector('[role="dialog"]')!;
		expect(dialog.getAttribute('aria-modal')).toBe('true');
		expect(dialog.getAttribute('aria-label')).toBe('Parent links to Cal');
		expect(dialog.querySelectorAll('li')).toHaveLength(2);
		expect(dialog.querySelector('button.remove')!.getAttribute('aria-label')).toBe('Remove biological link from Ann…');
	});

	it('offers every type except the current one, and reports the chosen change without altering the row', () => {
		const props = render();
		const select = document.querySelector('select[aria-label*="from Ben"]') as unknown as SelectLike;
		expect([...select.options].map((o) => o.value)).toEqual(['', 'biological', 'foster', 'guardian', 'unknown']);
		select.value = 'foster';
		select.dispatchEvent(new Event('change', { bubbles: true }));
		expect(props.onChangeType).toHaveBeenCalledWith(edge, edge.assertions[1], 'foster');
		expect(select.value).toBe('');
	});

	it('closes on Escape and keeps Tab inside the dialog', () => {
		const props = render();
		const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
		const focusable = [...dialog.querySelectorAll<HTMLElement>('button, select')];
		focusable.at(-1)!.focus();
		const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
		// A real key press is fired on the focused element and bubbles up to the dialog.
		document.activeElement!.dispatchEvent(tab);
		expect(tab.defaultPrevented).toBe(true);
		expect(document.activeElement).toBe(focusable[0]);
		document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
		flushSync();
		expect(props.onClose).toHaveBeenCalled();
	});
});
