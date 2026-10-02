import { afterEach, describe, expect, it } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import DateInput from './DateInput.svelte';

let component: Record<string, unknown> | null = null;
afterEach(() => {
	if (component) unmount(component);
	component = null;
	document.body.innerHTML = '';
});

function render(value: string) {
	// Accessors stand in for the parent's `bind:value`; runes aren't available outside .svelte files.
	const props = {
		id: 'd',
		get value() {
			return value;
		},
		set value(next: string) {
			value = next;
		}
	};
	component = mount(DateInput, { target: document.body, props });
	flushSync();
	return props;
}

describe('DateInput', () => {
	it('shows the expected format until something is typed', () => {
		render('');
		expect(document.querySelector('input')!.placeholder).toBe('e.g. 14 APR 1912');
	});

	it('explains a bad date once the field has been left', () => {
		render('31 FEB 1900');
		expect(document.querySelector('[role="alert"]')).toBeNull();
		document.querySelector('input')!.dispatchEvent(new FocusEvent('blur'));
		flushSync();
		expect(document.querySelector('[role="alert"]')!.textContent).toMatch(/doesn't have a day 31/);
	});

	it('writes the picked day back in the stored format, keeping a qualifier', () => {
		const props = render('ABT 3 MAR 1901');
		document.querySelector<HTMLButtonElement>('#d-picker-button')!.click();
		flushSync();
		document.querySelector<HTMLButtonElement>('[aria-label="14 March 1901"]')!.click();
		flushSync();
		expect(props.value).toBe('ABT 14 MAR 1901');
	});

	it('offers year-only for dates where the month is unknown', () => {
		const props = render('');
		document.querySelector<HTMLButtonElement>('#d-picker-button')!.click();
		flushSync();
		const year = document.querySelector<HTMLInputElement>('input[aria-label="Year"]')!;
		year.value = '1850';
		year.dispatchEvent(new Event('input', { bubbles: true }));
		flushSync();
		[...document.querySelectorAll('button')]
			.find((b) => b.textContent?.trim() === '1850 only')!
			.click();
		flushSync();
		expect(props.value).toBe('1850');
	});
});
