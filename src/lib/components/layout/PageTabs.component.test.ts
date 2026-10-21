import { afterEach, describe, expect, it } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import PageTabs from './PageTabs.svelte';

let component: Record<string, unknown> | null = null;
afterEach(() => {
	if (component) unmount(component);
	component = null;
	document.body.innerHTML = '';
});

const tabs = [
	{ href: '#profile', label: 'Profile', isCurrent: true },
	{ href: '/trees/a/members', label: 'Members', isCurrent: false }
];

function render() {
	component = mount(PageTabs, { target: document.body, props: { label: 'Test', tabs } as never });
	flushSync();
}

describe('PageTabs', () => {
	it('tells SvelteKit not to reset focus when a tab is followed', () => {
		render();
		for (const a of document.querySelectorAll('a')) {
			expect(a.getAttribute('data-sveltekit-reset')).toBe('false');
		}
	});

	it('refocuses a cross-page tab on the next page, where the pressed link was replaced', () => {
		render();
		const link = document.querySelectorAll('a')[1];
		link.addEventListener('click', (e) => e.preventDefault());
		link.click();
		unmount(component!);
		document.body.innerHTML = '';
		render();
		expect(document.activeElement).toBe(document.querySelectorAll('a')[1]);
	});
});
