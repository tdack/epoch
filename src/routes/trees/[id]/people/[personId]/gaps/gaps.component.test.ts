import { afterEach, expect, it } from 'vitest';
import { mount, unmount } from 'svelte';
import Page from './+page.svelte';

let component: Record<string, unknown> | null = null;
afterEach(() => {
	if (component) unmount(component);
	component = null;
	document.body.innerHTML = '';
});

const p = (id: string, name: string) => ({ id, name, isPrivate: false, birth: null, death: null });

it('shows completeness per generation and the brick walls', () => {
	component = mount(Page, {
		target: document.body,
		props: {
			data: {
				summary: { tree: { id: 't1', slug: 'foxes', name: 'Foxes' } },
				chart: {
					person: p('a', 'Ann Fox'),
					generations: 2,
					slots: [p('a', 'Ann Fox'), p('m', 'May Fox'), null],
					hasMoreAbove: false
				}
			}
		} as never
	});
	const cells = [...document.querySelectorAll('[data-testid="completeness"] tbody tr')].map((r) =>
		[...r.children].map((c) => c.textContent!.trim())
	);
	expect(cells).toEqual([
		['1', '1', '1', '100%'],
		['2', '1', '2', '50%']
	]);
	const wall = document.querySelector('[data-testid="brick-walls"] li')!;
	expect(wall.textContent).toContain('Ann Fox');
	expect(wall.textContent).toContain('One parent not recorded');
});
