import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';

vi.mock('#lib/api/lists.js', () => ({ suggestPlacesApi: vi.fn() }));
vi.mock('#lib/api/geo.js', () => ({ searchGeoApi: vi.fn() }));

import { suggestPlacesApi } from '#lib/api/lists.js';
import { searchGeoApi } from '#lib/api/geo.js';
import type { GeoCandidate } from '#lib/shared/geo.js';
import PlaceInput from './PlaceInput.svelte';

const suggest = vi.mocked(suggestPlacesApi);
const geo = vi.mocked(searchGeoApi);

let component: Record<string, unknown> | null = null;
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
	vi.useRealTimers();
	if (component) unmount(component);
	component = null;
	document.body.innerHTML = '';
	suggest.mockReset();
	geo.mockReset();
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

const ballarat: GeoCandidate = {
	name: 'Ballarat',
	displayName: 'Ballarat, Victoria, Australia',
	latitude: -37.56,
	longitude: 143.85,
	osmType: 'R',
	osmId: 1,
	kind: 'city',
	country: 'Australia',
	state: 'Victoria',
	county: null,
	city: 'Ballarat'
};

describe('PlaceInput with OpenStreetMap suggestions', () => {
	let picks: Array<GeoCandidate | null>;
	beforeEach(() => suggest.mockResolvedValue([]));
	function renderOsm() {
		picks = [];
		component = mount(PlaceInput, {
			target: document.body,
			props: {
				id: 'p',
				treeId: 't',
				value: '',
				shouldSuggestOsm: true,
				onosmpick: (c: GeoCandidate | null) => picks.push(c)
			}
		});
		flushSync();
	}
	const input = () => document.querySelector<HTMLInputElement>('#p')!;
	const key = (name: string) => {
		input().dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true }));
		flushSync();
	};
	const options = () =>
		[...document.querySelectorAll('[role=option]')].map((o) => o.textContent!.trim());
	const groups = () =>
		[...document.querySelectorAll('[role=group]')].map((g) =>
			g.querySelector('[role=presentation]')!.textContent!.trim()
		);

	it('asks OpenStreetMap only after 300 ms and three characters', async () => {
		geo.mockResolvedValue([]);
		renderOsm();
		await typeText('Ba');
		expect(geo).not.toHaveBeenCalled();
		input().value = 'Bal';
		input().dispatchEvent(new Event('input', { bubbles: true }));
		flushSync();
		await vi.advanceTimersByTimeAsync(299);
		expect(geo).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(1);
		expect(geo).toHaveBeenCalledWith('t', 'Bal', expect.any(AbortSignal));
	});

	it('aborts the request in flight when the user types on', async () => {
		geo.mockImplementation(() => new Promise(() => {}));
		renderOsm();
		await typeText('Bal');
		const signal = geo.mock.calls[0]![2]!;
		expect(signal.aborted).toBe(false);
		input().value = 'Ball';
		input().dispatchEvent(new Event('input', { bubbles: true }));
		flushSync();
		expect(signal.aborted).toBe(true);
	});

	it('lists the tree first and OpenStreetMap second, in two labelled groups', async () => {
		suggest.mockResolvedValue(['Ballarat East']);
		geo.mockResolvedValue([ballarat]);
		renderOsm();
		await typeText('Ballarat');
		expect(groups()).toEqual(['In this tree', 'From OpenStreetMap']);
		expect(options()).toEqual(['Ballarat East', 'Ballarat, Victoria, Australia (city)']);
		expect(document.body.textContent).toContain('© OpenStreetMap contributors');
		expect(input().getAttribute('role')).toBe('combobox');
		expect(input().getAttribute('aria-expanded')).toBe('true');
	});

	it('hides the group when OpenStreetMap answers nothing or fails', async () => {
		suggest.mockResolvedValue([]);
		geo.mockRejectedValue(new Error('down'));
		renderOsm();
		await typeText('Ballarat');
		expect(groups()).toEqual([]);
		expect(input().getAttribute('aria-expanded')).toBe('false');
	});

	it('walks both groups with the arrow keys and fills the pick in on Enter', async () => {
		suggest.mockResolvedValue(['Ballarat East']);
		geo.mockResolvedValue([ballarat]);
		renderOsm();
		await typeText('Ballarat');
		key('ArrowDown');
		key('ArrowDown');
		expect(input().getAttribute('aria-activedescendant')).toBe(
			document.querySelectorAll('[role=option]')[1]!.id
		);
		key('Enter');
		expect(input().value).toBe('Ballarat, Victoria, Australia');
		expect(picks).toEqual([ballarat]);
		expect(options()).toEqual([]);
	});

	it('leaves Enter to the form when nothing is highlighted', async () => {
		geo.mockResolvedValue([ballarat]);
		renderOsm();
		await typeText('Ballarat');
		const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
		input().dispatchEvent(event);
		expect(event.defaultPrevented).toBe(false);
		expect(picks).toEqual([]);
	});

	it('drops the pick when the text is edited away from it', async () => {
		geo.mockResolvedValue([ballarat]);
		renderOsm();
		await typeText('Ballarat');
		key('ArrowDown');
		key('Enter');
		await typeText('Ballarat, Victoria, Australia, again');
		expect(picks).toEqual([ballarat, null]);
	});

	it('"Find on map" searches at once and says when nothing matches', async () => {
		geo.mockResolvedValue([]);
		renderOsm();
		input().value = 'Ballarat';
		input().dispatchEvent(new Event('input', { bubbles: true }));
		flushSync();
		geo.mockClear();
		[...document.querySelectorAll('button')]
			.find((b) => b.textContent!.includes('Find on map'))!
			.click();
		await vi.advanceTimersByTimeAsync(0);
		flushSync();
		expect(geo).toHaveBeenCalledTimes(1);
		expect(document.body.textContent).toContain('No matches on OpenStreetMap.');
	});

	it('never asks OpenStreetMap unless it is switched on', async () => {
		render();
		await typeText('Ballarat');
		expect(geo).not.toHaveBeenCalled();
	});
});
