import { afterEach, describe, expect, it } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import Page from './+page.svelte';

let component: Record<string, unknown> | null = null;
afterEach(() => {
	if (component) unmount(component);
	component = null;
	document.body.innerHTML = '';
});

describe('the place report', () => {
	it('is a table of every fact, linked to its person, with an unknown date said so', () => {
		component = mount(Page, {
			target: document.body,
			props: {
				data: {
					summary: { tree: { id: 't1', slug: 'simpsons', name: 'Simpsons' } },
					place: {
						name: 'Springfield',
						hasMore: true,
						facts: [
							{
								id: 'f1',
								label: 'Birth',
								dateText: '1956',
								kind: 'person',
								entityId: 'p1',
								entityName: 'Homer Simpson'
							},
							{
								id: 'f2',
								label: 'Marriage',
								dateText: null,
								kind: 'partnership',
								entityId: 'u1',
								entityName: 'Homer & Marge'
							}
						]
					}
				}
			} as never
		});
		flushSync();
		const rows = [...document.querySelectorAll('tbody tr')];
		expect(rows).toHaveLength(2);
		expect(rows[0]!.querySelector('a')?.getAttribute('href')).toBe('/trees/simpsons/people/p1');
		expect(rows[1]!.querySelector('a')?.getAttribute('href')).toBe('/trees/simpsons/unions/u1');
		expect(rows[1]!.textContent).toContain('Date unknown');
		expect(document.querySelector('[data-testid=report-capped]')).not.toBeNull();
	});
});
