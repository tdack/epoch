import { afterEach, expect, it } from 'vitest';
import { mount, unmount } from 'svelte';
import Page from './+page.svelte';

let component: Record<string, unknown> | null = null;
afterEach(() => {
	if (component) unmount(component);
	component = null;
	document.body.innerHTML = '';
});

const fact = (id: string, type: string, label: string) => ({
	id,
	type,
	label,
	value: null,
	dateText: 'ABT 1900',
	place: 'Leeds'
});

it('lists each claim with its sources and says which key facts have none', () => {
	component = mount(Page, {
		target: document.body,
		props: {
			data: {
				summary: { tree: { id: 't1', slug: 'foxes', name: 'Foxes' } },
				person: {
					person: { id: 'a', displayName: 'Ann Fox' },
					names: [],
					facts: [fact('b', 'BIRT', 'Birth'), fact('d', 'DEAT', 'Death')],
					evidence: {
						links: [],
						citations: [
							{
								id: 'c1',
								subject: { kind: 'event', id: 'b' },
								sourceId: 's1',
								sourceLabel: 'Parish register',
								page: 'p. 4',
								quality: 3
							}
						]
					}
				}
			}
		} as never
	});
	const rows = [...document.querySelectorAll('[data-testid="evidence-summary"] tbody tr')];
	expect(rows[0]!.textContent).toContain('Parish register, p. 4');
	expect(rows[0]!.textContent).toContain('about 1900');
	expect(rows[0]!.querySelector('a')!.getAttribute('href')).toBe('/trees/foxes/sources/s1');
	expect(rows[1]!.textContent).toContain('No source yet: worth finding');
	expect(document.body.textContent).toContain('1 of 2 claims have a source.');
});
