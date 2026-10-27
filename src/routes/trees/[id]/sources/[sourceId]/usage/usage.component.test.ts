import { afterEach, describe, expect, it } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import Page from './+page.svelte';

let component: Record<string, unknown> | null = null;
afterEach(() => {
	if (component) unmount(component);
	component = null;
	document.body.innerHTML = '';
});

function render(hasMore: boolean) {
	component = mount(Page, {
		target: document.body,
		props: {
			data: {
				summary: { tree: { id: 't1', slug: 'simpsons', name: 'Simpsons' } },
				source: {
					id: 's1',
					title: 'Census 1851',
					abbreviation: null,
					citationCount: 900,
					hasMore,
					groups: [
						{
							label: 'the birth of Homer Simpson',
							personId: 'p1',
							unionId: null,
							fact: { dateText: 'ABT 1956', place: 'Springfield' },
							citations: [{ id: 'c1', page: 'p. 4', quality: null, text: null }]
						}
					]
				}
			}
		} as never
	});
	flushSync();
}

describe('the source usage report', () => {
	it('is a table of what the source supports, with the fact, date, place and page', () => {
		render(false);
		const row = document.querySelector('tbody tr')!;
		expect(row.querySelector('th[scope=row] a')?.getAttribute('href')).toBe(
			'/trees/simpsons/people/p1'
		);
		expect(row.textContent).toContain('about 1956');
		expect(row.textContent).toContain('Springfield');
		expect(row.textContent).toContain('p. 4');
		expect(document.querySelector('[data-testid=usage-capped]')).toBeNull();
	});

	it('says when the cap was reached', () => {
		render(true);
		expect(document.querySelector('[data-testid=usage-capped]')?.textContent).toContain(
			'first 500 of 900'
		);
	});
});
