import { afterEach, describe, expect, it } from 'vitest';
import { createRawSnippet, flushSync, mount, unmount } from 'svelte';
import { DEFAULT_PALETTE } from '#lib/components/tree/palette.js';
import Layout from './+layout.svelte';

let component: Record<string, unknown> | null = null;
afterEach(() => {
	if (component) unmount(component);
	component = null;
	document.body.innerHTML = '';
});

function render(isMotionReduced: boolean) {
	component = mount(Layout, {
		target: document.body,
		props: {
			data: { sourceUrl: '', sourceCommit: null, palette: DEFAULT_PALETTE, isMotionReduced },
			children: createRawSnippet(() => ({ render: () => '<p id="page">Page</p>' }))
		}
	});
	flushSync();
	return document.getElementById('page')!;
}

describe('root layout', () => {
	it('marks the page when the viewer reduces animation', () => {
		expect(render(true).closest('[data-reduce-motion]')).not.toBeNull();
	});

	it('leaves the page unmarked otherwise, so only the system setting applies', () => {
		expect(render(false).closest('[data-reduce-motion]')).toBeNull();
	});
});
