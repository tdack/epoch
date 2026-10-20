import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';

vi.mock('#lib/api/lists.js', () => ({ suggestPlacesApi: vi.fn() }));

import { suggestPlacesApi } from '#lib/api/lists.js';
import PlaceInput from './PlaceInput.svelte';

const suggest = vi.mocked(suggestPlacesApi);

let component: Record<string, unknown> | null = null;
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
	vi.useRealTimers();
	if (component) unmount(component);
	component = null;
	document.body.innerHTML = '';
	suggest.mockReset();
});

function render() {
	component = mount(PlaceInput, {
		target: document.body,
		props: { id: 'p', treeId: 't', value: '' }
	});
	flushSync();
}

async function typeText(text: string) {
	const input = document.querySelector<HTMLInputElement>('#p')!;
	input.value = text;
	input.dispatchEvent(new Event('input', { bubbles: true }));
	flushSync();
	await vi.advanceTimersByTimeAsync(300);
	flushSync();
}

const offered = () =>
	[...document.querySelector('#p')!.ownerDocument.querySelectorAll('datalist option')].map(
		(o) => (o as HTMLOptionElement).value
	);

describe('PlaceInput', () => {
	it('is wired to a datalist and asks nothing under two characters', async () => {
		render();
		const input = document.querySelector<HTMLInputElement>('#p')!;
		expect(input.list).toBe(document.querySelector('datalist'));
		await typeText('Y');
		expect(suggest).not.toHaveBeenCalled();
		expect(offered()).toEqual([]);
	});

	it('fills the datalist after the debounce', async () => {
		suggest.mockResolvedValue(['York, England']);
		render();
		await typeText('Yo');
		expect(suggest).toHaveBeenCalledWith('t', 'Yo');
		expect(offered()).toEqual(['York, England']);
	});

	it('shows no suggestions when the lookup fails', async () => {
		suggest.mockRejectedValue(new Error('offline'));
		render();
		await typeText('Yo');
		expect(offered()).toEqual([]);
	});

	it('keeps the latest answer when an earlier one arrives late', async () => {
		let resolveFirst: (v: string[]) => void = () => {};
		suggest.mockImplementationOnce(() => new Promise((r) => (resolveFirst = r)));
		suggest.mockResolvedValueOnce(['Leeds']);
		render();
		await typeText('Yo');
		await typeText('Le');
		expect(offered()).toEqual(['Leeds']);
		resolveFirst(['York']);
		await vi.advanceTimersByTimeAsync(0);
		flushSync();
		expect(offered()).toEqual(['Leeds']);
	});
});
