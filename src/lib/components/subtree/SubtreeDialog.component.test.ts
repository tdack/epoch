import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import SubtreeDialog from './SubtreeDialog.svelte';

beforeAll(() => {
	// jsdom has no modal dialog support; opening is all these tests need from it.
	HTMLDialogElement.prototype.showModal = function () {
		this.setAttribute('open', '');
	};
	HTMLDialogElement.prototype.close = function () {
		this.removeAttribute('open');
	};
});

let component: Record<string, unknown> | null = null;
afterEach(() => {
	if (component) unmount(component);
	component = null;
	document.body.innerHTML = '';
});

function render(props: Record<string, unknown> = {}) {
	const onsave = vi.fn();
	const onclose = vi.fn();
	component = mount(SubtreeDialog, {
		target: document.body,
		props: {
			isOpen: true,
			mode: 'create',
			initialName: 'Bouvier line',
			rootName: 'Clancy Bouvier',
			onsave,
			onclose,
			...props
		}
	});
	flushSync();
	return { onsave, onclose };
}

const input = (label: RegExp) =>
	[...document.querySelectorAll('label')]
		.filter((l) => label.test(l.textContent ?? ''))
		.map((l) => document.getElementById(l.htmlFor) as HTMLInputElement)[0]!;

function type(el: HTMLInputElement, value: string) {
	el.value = value;
	el.dispatchEvent(new Event('input', { bubbles: true }));
	flushSync();
}

const submit = () => {
	document.querySelector('form')!.dispatchEvent(new SubmitEvent('submit', { cancelable: true }));
	flushSync();
};

describe('SubtreeDialog', () => {
	it('prefills the address from the name and shows the root read-only', () => {
		render();
		expect(input(/Address/).value).toBe('bouvier-line');
		expect(document.querySelector('[data-testid="subtree-root"]')?.textContent).toBe(
			'Clancy Bouvier'
		);
	});

	it('lets the address follow the name until it is edited by hand', () => {
		render();
		type(input(/Name/), 'Flanders family');
		expect(input(/Address/).value).toBe('flanders-family');
		type(input(/Address/), 'flanders');
		type(input(/Name/), 'Something else');
		expect(input(/Address/).value).toBe('flanders');
	});

	it('saves the trimmed name and the address', () => {
		const { onsave } = render();
		type(input(/Name/), '  Flanders line ');
		submit();
		expect(onsave).toHaveBeenCalledWith('Flanders line', 'flanders-line');
	});

	it('refuses an invalid address and an empty name without saving', () => {
		const { onsave } = render();
		type(input(/Address/), 'Not Valid!');
		submit();
		expect(document.body.textContent).toContain('lower-case letters');
		type(input(/Name/), '  ');
		submit();
		expect(document.body.textContent).toContain('enter a name');
		expect(onsave).not.toHaveBeenCalled();
	});

	it('shows the server error inline', () => {
		render({ error: 'That address is taken' });
		expect(document.body.textContent).toContain('That address is taken');
	});

	it('edits with the existing address kept', () => {
		const { onsave } = render({ mode: 'edit', initialName: 'Old', initialSlug: 'old-slug' });
		type(input(/Name/), 'New');
		expect(input(/Address/).value).toBe('old-slug');
		submit();
		expect(onsave).toHaveBeenCalledWith('New', 'old-slug');
	});
});
