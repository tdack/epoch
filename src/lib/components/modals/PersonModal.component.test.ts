import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import PersonModal from './PersonModal.svelte';

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

/** An impossible saved date, as imported: it has to be editable, not just tolerated. */
const SAVED_BIRTH = '30 FEB 1946';

function render() {
	const onsubmit = vi.fn();
	component = mount(PersonModal, {
		target: document.body,
		props: {
			isOpen: true,
			mode: 'edit',
			initialPerson: {
				id: 'p1',
				name: 'John Henry Smith',
				givenName: 'John Henry',
				surname: 'Smith',
				sex: 'M',
				notice: null,
				raw: {
					version: 1,
					sex: 'M',
					givenName: 'John Henry',
					surname: 'Smith',
					events: [{ type: 'BIRT', dateRaw: SAVED_BIRTH, place: null }]
				}
			},
			onclose: () => {},
			onsubmit
		}
	});
	flushSync();
	return onsubmit;
}

const birthField = () => document.querySelector<HTMLInputElement>('#person-birth-date-field')!;

function type(input: HTMLInputElement, text: string) {
	input.value = text;
	input.dispatchEvent(new Event('input', { bubbles: true }));
	flushSync();
}

function submit() {
	document.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
	flushSync();
}

describe('PersonModal', () => {
	it('keeps a typed correction to an unreadable saved date, and the other edits with it', () => {
		const onsubmit = render();
		expect(birthField().value).toBe(SAVED_BIRTH);
		type(document.querySelector<HTMLInputElement>('#person-given-name-field')!, 'John');
		type(birthField(), '28 FEB 1946');
		expect(birthField().value).toBe('28 FEB 1946');
		submit();
		expect(onsubmit).toHaveBeenCalledWith(
			expect.objectContaining({ givenName: 'John', birthDate: '28 FEB 1946' })
		);
	});

	it('keeps a date picked over an unreadable saved date', () => {
		render();
		document.querySelector<HTMLButtonElement>('#person-birth-date-field-picker-button')!.click();
		flushSync();
		const year = document.querySelector<HTMLInputElement>('input[aria-label="Year"]')!;
		type(year, '1946');
		[...document.querySelectorAll('button')]
			.find((b) => b.textContent?.trim() === '1946 only')!
			.click();
		flushSync();
		expect(birthField().value).toBe('1946');
	});

	it('refuses a new date it cannot read, but saves the unreadable one left as it was', () => {
		const onsubmit = render();
		type(birthField(), '31 FEB 1946');
		submit();
		expect(onsubmit).not.toHaveBeenCalled();
		expect(birthField().value).toBe('31 FEB 1946');
		type(birthField(), SAVED_BIRTH);
		submit();
		expect(onsubmit).toHaveBeenCalledWith(expect.objectContaining({ birthDate: SAVED_BIRTH }));
	});
});
