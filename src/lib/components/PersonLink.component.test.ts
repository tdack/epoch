import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import PersonLink from './PersonLink.svelte';

let component: Record<string, unknown> | null = null;
afterEach(() => {
	if (component) unmount(component);
	component = null;
	document.body.innerHTML = '';
});

const ann = { id: 'p1', displayName: 'Ann Lee', isPrivate: false };

function render(props: Record<string, unknown>) {
	component = mount(PersonLink, {
		target: document.body,
		props: { person: ann, href: '/x', ...props }
	});
	flushSync();
}

describe('PersonLink', () => {
	it('is a link by default', () => {
		render({});
		expect(document.querySelector('a')?.getAttribute('href')).toBe('/x');
		expect(document.querySelector('button')).toBeNull();
	});

	it('is a button that hands over the id when the target selects in place', () => {
		const onSelect = vi.fn();
		render({ relativeTarget: { kind: 'select', onSelect } });
		expect(document.querySelector('a')).toBeNull();
		const button = document.querySelector('button')!;
		expect(button.textContent).toBe('Ann Lee');
		button.click();
		expect(onSelect).toHaveBeenCalledWith('p1');
	});

	it('names a private person without making them clickable in either mode', () => {
		render({
			person: { ...ann, isPrivate: true },
			relativeTarget: { kind: 'select', onSelect: vi.fn() }
		});
		expect(document.querySelector('a, button')).toBeNull();
		expect(document.body.textContent).toContain('Ann Lee');
	});
});
