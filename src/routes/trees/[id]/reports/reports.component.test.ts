import { afterEach, describe, expect, it } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import Page from './+page.svelte';

let component: Record<string, unknown> | null = null;
afterEach(() => {
	if (component) unmount(component);
	component = null;
	document.body.innerHTML = '';
});

type Person = { id: string; name: string };
function render({
	me = null,
	focus = null,
	union = null
}: {
	me?: Person | null;
	focus?: Person | null;
	union?: { id: string; partners: Person[] } | null;
}) {
	component = mount(Page, {
		target: document.body,
		props: {
			data: {
				summary: { tree: { id: 't1', slug: 'simpsons', name: 'Simpsons' }, viewer: {} },
				me,
				focus,
				union
			}
		} as never
	});
	flushSync();
}

const kinHref = () =>
	document.querySelector('[data-testid="person-reports"] a[href$="/kin"]')?.getAttribute('href');

describe('the reports page', () => {
	it('reports on the person a Reports link names, ahead of the member’s own', () => {
		render({ me: { id: 'me', name: 'Me' }, focus: { id: 'bart', name: 'Bart' } });
		expect(kinHref()).toBe('/trees/simpsons/people/bart/kin');
	});

	it('falls back to the member’s own person', () => {
		render({ me: { id: 'me', name: 'Me' } });
		expect(kinHref()).toBe('/trees/simpsons/people/me/kin');
	});

	it('offers a partnership’s group sheet and each partner as the subject', () => {
		render({
			union: {
				id: 'u1',
				partners: [
					{ id: 'homer', name: 'Homer' },
					{ id: 'marge', name: 'Marge' }
				]
			}
		});
		const reports = document.querySelector('[data-testid="union-reports"]')!;
		expect(reports.querySelector('a')?.getAttribute('href')).toBe(
			'/trees/simpsons/unions/u1/sheet'
		);
		expect(reports.textContent).toContain('Homer and Marge');
		expect(kinHref()).toBe('/trees/simpsons/people/homer/kin');
		[...reports.querySelectorAll('button')].find((b) => b.textContent?.includes('Marge'))!.click();
		flushSync();
		expect(kinHref()).toBe('/trees/simpsons/people/marge/kin');
	});
});
