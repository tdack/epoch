import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import TreeGestureHint from './TreeGestureHint.svelte';

let component: Record<string, unknown> | null = null;

beforeEach(() => {
	vi.stubGlobal('matchMedia', () => ({ matches: false }));
});
afterEach(() => {
	if (component) unmount(component);
	component = null;
	document.body.innerHTML = '';
	vi.unstubAllGlobals();
});

function hintText(props: { hasMenuActions: boolean }): string {
	component = mount(TreeGestureHint, { target: document.body, props });
	flushSync();
	return document.body.textContent?.replace(/\s+/g, ' ') ?? '';
}

describe('TreeGestureHint', () => {
	it('points a role with menu actions at right-click', () => {
		expect(hintText({ hasMenuActions: true })).toContain('right-click for more');
	});

	it('does not send a viewer to a menu that only repeats double-click', () => {
		const text = hintText({ hasMenuActions: false });
		expect(text).toContain('Double-click to see their details.');
		expect(text).not.toContain('right-click');
	});
});
