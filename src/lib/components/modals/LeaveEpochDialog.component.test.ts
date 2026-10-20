import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import type { LeaveBlockersDto } from '#lib/shared/profile.js';
import LeaveEpochDialog from './LeaveEpochDialog.svelte';

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

const NO_BLOCKERS: LeaveBlockersDto = { isInstallOwner: false, soleOwnerTrees: [] };

function open(blockers: LeaveBlockersDto = NO_BLOCKERS, onleave = vi.fn()) {
	component = mount(LeaveEpochDialog, {
		target: document.body,
		props: { isOpen: true, email: 'Ada@Example.com', blockers, onclose: vi.fn(), onleave }
	});
	flushSync();
	const confirm = () =>
		[...document.querySelectorAll('button')].find((b) => b.textContent?.includes('Leave Epoch'))!;
	const input = document.querySelector<HTMLInputElement>('#leave-confirm')!;
	return { confirm, input, onleave };
}

describe('LeaveEpochDialog', () => {
	it('keeps Leave disabled until the email matches, ignoring case and spaces', () => {
		const { confirm, input, onleave } = open();
		expect(confirm().disabled).toBe(true);
		input.value = 'ada@example';
		input.dispatchEvent(new Event('input', { bubbles: true }));
		flushSync();
		expect(confirm().disabled).toBe(true);
		input.value = '  ada@EXAMPLE.com ';
		input.dispatchEvent(new Event('input', { bubbles: true }));
		flushSync();
		expect(confirm().disabled).toBe(false);
		confirm().click();
		expect(onleave).toHaveBeenCalledOnce();
	});

	it('links the warning to the input and button', () => {
		const { confirm, input } = open();
		expect(document.getElementById('leave-warning')?.textContent).toContain('cannot undo');
		expect(input.getAttribute('aria-describedby')).toBe('leave-warning');
		expect(confirm().getAttribute('aria-describedby')).toBe('leave-warning');
	});

	it('lists the trees that need an owner and blocks confirmation', () => {
		const { confirm, input } = open({
			isInstallOwner: true,
			soleOwnerTrees: [{ id: 't1', name: 'The Lovelaces' }]
		});
		expect(document.querySelector('[role="alert"]')?.textContent).toContain('The Lovelaces');
		expect(document.querySelector('[role="alert"]')?.textContent).toContain('own this Epoch');
		expect(input.disabled).toBe(true);
		expect(confirm().disabled).toBe(true);
	});
});
