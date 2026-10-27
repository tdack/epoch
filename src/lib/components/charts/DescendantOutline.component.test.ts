import { afterEach, describe, expect, it } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import DescendantOutline from './DescendantOutline.svelte';

let component: Record<string, unknown> | null = null;
afterEach(() => {
	if (component) unmount(component);
	component = null;
	document.body.innerHTML = '';
});

const node = (id: string, children: unknown[] = []) => ({
	person: { id, name: id, isPrivate: false, birth: null, death: null },
	partners: [],
	children
});

describe('descendant outline', () => {
	it("numbers each person in d'Aboville style", () => {
		component = mount(DescendantOutline, {
			target: document.body,
			props: {
				root: node('ann', [node('bo', [node('cy')]), node('di')]),
				hrefFor: (id: string) => `/${id}`
			} as never
		});
		flushSync();
		expect(
			[...document.querySelectorAll('[data-testid="outline-number"]')].map((n) => n.textContent)
		).toEqual(['1', '1.1', '1.1.1', '1.2']);
	});
});
