import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import RenameTreeModal from './RenameTreeModal.svelte';

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

function render(treeSlug: string | null = 'the-windsors') {
	const onrename = vi.fn();
	const onclose = vi.fn();
	component = mount(RenameTreeModal, {
		target: document.body,
		props: { isOpen: true, treeName: 'The Windsors', treeSlug, treeVersion: 4, onclose, onrename }
	});
	flushSync();
	return { onrename, onclose };
}

function fill(id: string, value: string) {
	const input = document.getElementById(id) as HTMLInputElement;
	input.value = value;
	input.dispatchEvent(new Event('input', { bubbles: true }));
	flushSync();
}

function submit() {
	document.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
	flushSync();
}

describe('RenameTreeModal', () => {
	it('starts from the current name and address', () => {
		render();
		expect((document.getElementById('tree-rename-input') as HTMLInputElement).value).toBe(
			'The Windsors'
		);
		expect((document.getElementById('tree-slug-input') as HTMLInputElement).value).toBe(
			'the-windsors'
		);
	});

	it('keeps the address on a rename', () => {
		const { onrename } = render();
		fill('tree-rename-input', 'House of Windsor');
		submit();
		expect(onrename).toHaveBeenCalledWith('House of Windsor', 'the-windsors', 4);
	});

	it('sends a new address, and null for an empty one', () => {
		const { onrename } = render();
		fill('tree-slug-input', 'house-of-windsor');
		submit();
		expect(onrename).toHaveBeenLastCalledWith('The Windsors', 'house-of-windsor', 4);
		fill('tree-slug-input', '  ');
		submit();
		expect(onrename).toHaveBeenLastCalledWith('The Windsors', null, 4);
	});

	it('refuses an address the server would refuse, and says why', () => {
		const { onrename } = render();
		fill('tree-slug-input', 'House Of Windsor');
		submit();
		expect(onrename).not.toHaveBeenCalled();
		expect(document.body.textContent).toContain('lower-case letters');
	});

	it('closes without a request when nothing changed', () => {
		const { onrename, onclose } = render();
		submit();
		expect(onrename).not.toHaveBeenCalled();
		expect(onclose).toHaveBeenCalled();
	});
});
