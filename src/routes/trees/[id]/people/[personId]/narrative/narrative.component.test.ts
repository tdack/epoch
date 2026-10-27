import { afterEach, describe, expect, it } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import Page from './+page.svelte';

let component: Record<string, unknown> | null = null;
afterEach(() => {
	if (component) unmount(component);
	component = null;
	document.body.innerHTML = '';
});

function render() {
	component = mount(Page, {
		target: document.body,
		props: {
			data: {
				summary: { tree: { id: 't1', slug: 'foxes', name: 'Foxes' } },
				narrative: {
					kind: 'descendants',
					person: { id: 'a', name: 'Ann Fox' },
					generations: 2,
					hasMore: true,
					numbering: 'daboville',
					entries: [
						{
							number: '1',
							generation: 1,
							personId: 'a',
							name: 'Ann Fox',
							isPrivate: false,
							seeNumber: null,
							sentences: [
								{ text: 'Ann was born in 1900.', notes: [1] },
								{ text: 'She died in 1970.', notes: [] }
							]
						},
						{
							number: '1.1',
							generation: 2,
							personId: 'k',
							name: 'Kit Fox',
							isPrivate: false,
							seeNumber: '1',
							sentences: []
						},
						{
							number: '1.2',
							generation: 2,
							personId: 'p',
							name: 'Hidden',
							isPrivate: true,
							seeNumber: null,
							sentences: []
						}
					],
					endnotes: [{ number: 1, text: 'Birth certificate' }]
				}
			}
		} as never
	});
	flushSync();
}

describe('narrative page', () => {
	it('tells each generation, links repeats and endnotes, and hides a private entry', () => {
		render();
		expect([...document.querySelectorAll('h2')].map((h) => h.textContent!.trim())).toEqual([
			'Generation 1',
			'Generation 2',
			'Notes'
		]);
		const [first, repeat, hidden] = [...document.querySelectorAll('article')];
		expect(first!.id).toBe('entry-1');
		expect(first!.querySelector('sup a')!.getAttribute('href')).toBe('#note-1');
		expect(repeat!.textContent).toContain('See number 1');
		expect(repeat!.querySelector('p a')!.getAttribute('href')).toBe('#entry-1');
		expect(hidden!.textContent).toContain('Private');
		expect(hidden!.textContent).not.toContain('Hidden');
		expect(hidden!.querySelector('p')).toBeNull();
		expect(document.getElementById('note-1')!.textContent).toBe('Birth certificate');
		expect(document.querySelector('[data-testid="more"]')).not.toBeNull();
	});
});
