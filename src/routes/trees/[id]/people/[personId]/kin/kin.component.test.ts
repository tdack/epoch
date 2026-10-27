import { afterEach, expect, it } from 'vitest';
import { mount, unmount } from 'svelte';
import Page from './+page.svelte';

let component: Record<string, unknown> | null = null;
afterEach(() => {
	if (component) unmount(component);
	component = null;
	document.body.innerHTML = '';
});

it('lists relatives with their relationship and dates in words', () => {
	component = mount(Page, {
		target: document.body,
		props: {
			data: {
				summary: { tree: { id: 't1', slug: 'foxes', name: 'Foxes' } },
				kin: {
					person: { id: 'a', name: 'Ann Fox', isPrivate: false },
					generations: 3,
					isIncomplete: true,
					entries: [
						{
							id: 'k',
							name: 'Kit Fox',
							label: '1st cousin',
							distance: 4,
							birth: 'ABT 1900',
							death: null
						}
					]
				}
			}
		} as never
	});
	const row = document.querySelector('[data-testid="kin-list"] tbody tr')!;
	expect(row.textContent).toContain('Kit Fox');
	expect(row.textContent).toContain('1st cousin');
	expect(row.textContent).toContain('about 1900');
	expect(row.querySelector('a')!.getAttribute('href')).toBe('/trees/foxes/people/k');
	expect(document.body.textContent).toContain('more relatives may be recorded');
});
