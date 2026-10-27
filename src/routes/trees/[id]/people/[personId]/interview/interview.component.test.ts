import { afterEach, expect, it } from 'vitest';
import { mount, unmount } from 'svelte';
import Page from './+page.svelte';

let component: Record<string, unknown> | null = null;
afterEach(() => {
	if (component) unmount(component);
	component = null;
	document.body.innerHTML = '';
});

it('asks to confirm what is recorded and asks after what is missing', () => {
	const birth = {
		id: 'b',
		type: 'BIRT',
		label: 'Birth',
		value: null,
		dateText: 'ABT 1950',
		place: null
	};
	component = mount(Page, {
		target: document.body,
		props: {
			data: {
				summary: { tree: { id: 't1', slug: 'foxes', name: 'Foxes' } },
				person: {
					person: { id: 'a', displayName: 'Ann Fox', isDeceased: false },
					vitals: { birth, death: null },
					facts: [birth],
					parentFamilies: [],
					partnerships: [],
					directChildren: []
				}
			}
		} as never
	});
	expect(document.querySelector('[data-testid="interview-recorded"]')!.textContent).toContain(
		'Birth (about 1950)'
	);
	const missing = document.querySelector('[data-testid="interview-missing"]')!.textContent!;
	expect(missing).toContain('Where was Ann Fox born?');
	expect(missing).toContain("full names of Ann Fox's parents");
	expect(missing).not.toContain('laid to rest');
});
