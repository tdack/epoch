import { afterEach, describe, expect, it } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import Pager from './Pager.svelte';

let component: Record<string, unknown> | null = null;
afterEach(() => {
	if (component) unmount(component);
	component = null;
	document.body.innerHTML = '';
});

const hrefFor = (n: number) => `/p?page=${n}`;

function render(current: number, count: number) {
	component = mount(Pager, {
		target: document.body,
		props: {
			summary: 'x',
			previousHref: current > 1 ? hrefFor(current - 1) : null,
			nextHref: current < count ? hrefFor(current + 1) : null,
			pages: { current, count, hrefFor }
		}
	});
	flushSync();
}

const labels = () =>
	[...document.querySelectorAll('nav a, nav span[aria-disabled], nav span[aria-current]')].map(
		(e) => e.textContent?.trim()
	);
const text = () =>
	[...document.querySelector('nav span.flex')!.children]
		.map((e) => e.textContent!.trim())
		.join(' ');

describe('Pager numbered pages', () => {
	it('windows the numbers around the current page, keeping the ends', () => {
		render(6, 20);
		expect(text()).toBe('First Previous 1 … 4 5 6 7 8 … 20 Next Last');
		expect(document.querySelector('[aria-current="page"]')!.textContent).toBe('6');
	});

	it('shows every number when there are few pages and no gap', () => {
		render(2, 4);
		expect(text()).toBe('First Previous 1 2 3 4 Next Last');
	});

	it('disables First and Previous on page 1, and Next and Last on the last page', () => {
		render(1, 3);
		const disabled = () =>
			[...document.querySelectorAll('[aria-disabled="true"]')].map((e) => e.textContent);
		expect(disabled()).toEqual(['First', 'Previous']);
		unmount(component!);
		document.body.innerHTML = '';
		render(3, 3);
		expect(disabled()).toEqual(['Next', 'Last']);
		expect(labels()).toContain('First');
	});

	it('links First and Last to the ends', () => {
		render(5, 9);
		const hrefs = [...document.querySelectorAll('a')].map((a) => a.getAttribute('href'));
		expect(hrefs[0]).toBe('/p?page=1');
		expect(hrefs.at(-1)).toBe('/p?page=9');
	});

	it('is unchanged without numbered pages', () => {
		component = mount(Pager, {
			target: document.body,
			props: { summary: 's', previousHref: null, nextHref: '/n' }
		});
		flushSync();
		expect(document.body.textContent!.replace(/\s+/g, ' ')).toContain('Previous Next');
		expect(document.body.textContent).not.toContain('First');
	});
});
