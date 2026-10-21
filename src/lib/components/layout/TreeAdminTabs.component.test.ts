import { afterEach, describe, expect, it } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import TreeAdminTabs from './TreeAdminTabs.svelte';

let component: Record<string, unknown> | null = null;
afterEach(() => {
	if (component) unmount(component);
	component = null;
	document.body.innerHTML = '';
});

function tabsFor(role: string) {
	component = mount(TreeAdminTabs, {
		target: document.body,
		props: { treeName: 'The Smiths', base: '/trees/smiths', current: 'audit', role } as never
	});
	flushSync();
	return [...document.querySelectorAll('a')].map((a) => [
		a.textContent!.trim(),
		a.getAttribute('href')
	]);
}

describe('TreeAdminTabs', () => {
	it('gives a manager every tab of the tree administration', () => {
		expect(tabsFor('manager')).toEqual([
			['Settings', '/trees/smiths/settings'],
			['Sub-trees', '/trees/smiths/settings#subtrees'],
			['Export', '/trees/smiths/settings#export'],
			['Members', '/trees/smiths/members'],
			['Audit log', '/trees/smiths/audit']
		]);
		expect(document.querySelector('[aria-current="page"]')!.textContent!.trim()).toBe('Audit log');
	});

	it('gives an editor the audit log alone, since they administer nothing else', () => {
		expect(tabsFor('editor')).toEqual([['Audit log', '/trees/smiths/audit']]);
	});
});
