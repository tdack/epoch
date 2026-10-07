import { afterEach, describe, expect, it, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import OffscreenMarkers from './OffscreenMarkers.svelte';
import type { OffscreenMarker } from './view-geometry.js';

let component: Record<string, unknown> | null = null;
afterEach(() => {
	if (component) unmount(component);
	component = null;
	document.body.innerHTML = '';
});

const right: OffscreenMarker = { direction: 'right', count: 3, pan: { x: -400, y: 0 } };
const below: OffscreenMarker = { direction: 'down', count: 1, pan: { x: 0, y: -300 } };

function render(markers: OffscreenMarker[], onPan = vi.fn()) {
	component = mount(OffscreenMarkers, { target: document.body, props: { markers, onPan } });
	flushSync();
	return onPan;
}

describe('OffscreenMarkers', () => {
	it('draws nothing when no one is off-screen', () => {
		render([]);
		expect(document.querySelectorAll('button')).toHaveLength(0);
	});

	it('names each marker by count, side and action', () => {
		render([right, below]);
		const names = [...document.querySelectorAll('button')].map((b) => b.getAttribute('aria-label'));
		expect(names).toEqual(['3 relatives to the right, show them', '1 relative below, show them']);
	});

	it('hands the marker back when activated', () => {
		const onPan = render([right]);
		document.querySelector('button')!.click();
		expect(onPan).toHaveBeenCalledWith(right);
	});
});
