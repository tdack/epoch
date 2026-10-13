import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import { EMPTY_LAYOUT, type TreeLayout } from '#lib/tree-layout/index.js';
import TreeMinimap from './TreeMinimap.svelte';

let component: Record<string, unknown> | null = null;
afterEach(() => {
	if (component) unmount(component);
	component = null;
	document.body.innerHTML = '';
});

const person = (id: string, x: number, y: number) =>
	({ id, x, y, generation: 0, role: 'focus', person: {} }) as TreeLayout['people'][number];
const layout: TreeLayout = {
	...EMPTY_LAYOUT,
	focusPersonId: 'a',
	people: [person('a', -895, 37), person('b', 895, 463)],
	bounds: { minX: -1000, minY: 0, maxX: 1000, maxY: 500 }
};

function render(transform = { x: 500, y: 0, k: 1 }, onCentre = vi.fn()) {
	component = mount(TreeMinimap, {
		target: document.body,
		props: { layout, transform, size: { width: 1000, height: 500 }, onCentre }
	});
	flushSync();
	return onCentre;
}

describe('TreeMinimap', () => {
	it('draws every person and frames the part the canvas shows', () => {
		render();
		expect(document.querySelectorAll('rect.card')).toHaveLength(2);
		expect(document.querySelectorAll('rect.focus')).toHaveLength(1);
		const view = document.querySelector('[data-testid="tree-minimap-view"]')!;
		// Layout x from -500 to 500 of a 2000-wide tree, at a tenth of the size.
		expect(Number(view.getAttribute('x'))).toBeCloseTo(50);
		expect(Number(view.getAttribute('width'))).toBeCloseTo(100);
	});

	it('centres the canvas where it is pressed, and does not let the click through', () => {
		const onCentre = render();
		const svg = document.querySelector('svg')!;
		svg.getBoundingClientRect = () => ({ left: 0, top: 0 }) as DOMRect;
		svg.dispatchEvent(
			new PointerEvent('pointerdown', {
				bubbles: true,
				button: 0,
				clientX: 150,
				clientY: 25,
				pointerId: 1
			})
		);
		expect(onCentre).toHaveBeenCalledWith(500, 250, true);
		// The canvas clears the selection on a click that reaches it.
		const click = new MouseEvent('click', { bubbles: true });
		const stop = vi.spyOn(click, 'stopPropagation');
		svg.dispatchEvent(click);
		expect(stop).toHaveBeenCalled();
	});
});
