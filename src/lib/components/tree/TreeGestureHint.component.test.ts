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

function hintText(): string {
	component = mount(TreeGestureHint, { target: document.body, props: {} });
	flushSync();
	return document.body.textContent?.replace(/\s+/g, ' ') ?? '';
}

describe('TreeGestureHint', () => {
	it('points at right-click for the person menu', () => {
		expect(hintText()).toContain('right-click for more');
	});
});
