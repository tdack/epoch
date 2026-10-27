import { afterEach, describe, expect, it } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import Page from './+page.svelte';

let component: Record<string, unknown> | null = null;
afterEach(() => {
	if (component) unmount(component);
	component = null;
	document.body.innerHTML = '';
});

const person = (id: string, displayName: string, isPrivate = false) => ({
	id,
	displayName,
	isPrivate,
	sex: null,
	birthDate: null,
	birthSort: null,
	deathDate: null,
	isDeceased: false
});

function render() {
	const ann = person('a', 'Ann Fox');
	const kit = person('k', 'Kit Fox');
	const hidden = person('h', 'Private person', true);
	component = mount(Page, {
		target: document.body,
		props: {
			data: {
				summary: { tree: { id: 't1', slug: 'foxes', name: 'Foxes' } },
				sheet: {
					page: {
						union: { id: 'u1', status: 'active', label: null },
						partners: [ann, person('b', 'Bob Fox')],
						events: [],
						notes: [],
						evidence: {
							citations: [{ id: 'c1', sourceLabel: 'Parish register', page: 'p. 4', text: null }],
							links: []
						},
						children: [
							{
								person: kit,
								links: [{ parentId: 'a', parentName: 'Ann Fox', type: 'adoptive' }]
							},
							{ person: hidden, links: [] }
						]
					},
					vitals: {
						k: [
							{ type: 'BIRT', label: 'Birth', dateText: '1950', place: 'Leeds' },
							{ type: 'DEAT', label: 'Death', dateText: '2001', place: null }
						]
					},
					parents: {},
					partnersOfChildren: { k: [{ unionId: 'u2', person: person('m', 'Max Moss') }] }
				}
			}
		} as never
	});
	flushSync();
}

describe('family group sheet', () => {
	it('names partners neutrally and reads the children as a table', () => {
		render();
		const headings = [...document.querySelectorAll('h2')].map((h) => h.textContent);
		expect(headings).toEqual(
			expect.arrayContaining(['Partner 1', 'Partner 2', 'Children', 'Sources'])
		);
		expect(document.body.textContent).not.toMatch(/husband|wife/i);
		const rows = document.querySelectorAll('[data-testid="sheet-children"] tbody tr');
		expect(rows).toHaveLength(2);
		expect(rows[0]!.querySelector('th[scope="row"]')!.textContent).toContain('adopted by Ann Fox');
		const cells = [...rows[0]!.querySelectorAll('td')].map((c) => c.textContent!.trim());
		expect(cells[0]).toContain('Leeds');
		expect(cells[1]).toContain('2001');
		expect(cells[2]).toBe('Max Moss');
		// A placeholder shows its name and nothing else.
		expect(rows[1]!.textContent!.trim()).toBe('Private person');
		expect(document.querySelector('ol li')!.textContent).toBe('Parish register, p. 4');
	});
});
