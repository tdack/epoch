import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import MapsSettingsForm from './MapsSettingsForm.svelte';

let component: Record<string, unknown> | null = null;
afterEach(() => {
	if (component) unmount(component);
	component = null;
	document.body.innerHTML = '';
});

function render() {
	const onsave = vi.fn(async () => {});
	component = mount(MapsSettingsForm, {
		target: document.body,
		props: { stored: undefined, onsave }
	});
	flushSync();
	return onsave;
}

const saveButton = () =>
	[...document.querySelectorAll('button')].find(
		(b) => b.textContent?.trim() === 'Save map settings'
	)!;

describe('MapsSettingsForm', () => {
	it('enables Save once an address is edited, and saves the new address', async () => {
		const onsave = render();
		expect(saveButton().disabled).toBe(true);

		const photon = document.querySelector<HTMLInputElement>('#maps-photon-url')!;
		photon.value = 'https://photon.example.org';
		photon.dispatchEvent(new Event('input', { bubbles: true }));
		flushSync();
		expect(saveButton().disabled).toBe(false);

		saveButton().click();
		await vi.waitFor(() => expect(onsave).toHaveBeenCalled());
		expect(onsave).toHaveBeenCalledWith({
			maps: expect.objectContaining({ photonUrl: 'https://photon.example.org' })
		});
	});

	it('enables Use the defaults for an unsaved edit, and undoes it without saving', () => {
		const onsave = render();
		const defaults = [...document.querySelectorAll('button')].find(
			(b) => b.textContent?.trim() === 'Use the defaults'
		)!;
		expect(defaults.disabled).toBe(true);

		const photon = document.querySelector<HTMLInputElement>('#maps-photon-url')!;
		const original = photon.value;
		photon.value = 'https://photon.example.org';
		photon.dispatchEvent(new Event('input', { bubbles: true }));
		flushSync();
		expect(defaults.disabled).toBe(false);

		defaults.click();
		flushSync();
		expect(photon.value).toBe(original);
		expect(saveButton().disabled).toBe(true);
		expect(onsave).not.toHaveBeenCalled();
	});
});
