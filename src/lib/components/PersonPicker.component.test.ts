import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';

vi.mock('#lib/services/tree-api.js', () => ({
	searchPeopleApi: vi.fn()
}));

import { searchPeopleApi } from '#lib/services/tree-api.js';
import PersonPicker from './PersonPicker.svelte';

const search = vi.mocked(searchPeopleApi);

let component: Record<string, unknown> | null = null;
beforeEach(() => {
	vi.useFakeTimers();
	search.mockReset();
});
afterEach(() => {
	vi.useRealTimers();
	if (component) unmount(component);
	component = null;
	document.body.innerHTML = '';
});

function render(onpick = vi.fn()) {
	component = mount(PersonPicker, {
		target: document.body,
		props: { treeId: 't1', label: 'Attach to', picked: null, onpick }
	});
	flushSync();
	return onpick;
}

/** Types a query and lets the debounce and the request settle. */
async function typeQuery(text: string) {
	const input = document.querySelector<HTMLInputElement>('input[role="combobox"]')!;
	input.value = text;
	input.dispatchEvent(new Event('input', { bubbles: true }));
	flushSync();
	await vi.advanceTimersByTimeAsync(300);
	flushSync();
	return input;
}

const options = () =>
	[...document.querySelectorAll('[role="option"]')].map((o) => o.textContent?.trim());

describe('PersonPicker', () => {
	it('shows the matches in a labelled listbox once typing pauses', async () => {
		search.mockResolvedValue([
			{ id: 'p1', givenName: 'Ada', surname: 'Lovelace' },
			{ id: 'p2', givenName: null, surname: null }
		]);
		render();
		expect(document.querySelector('label')!.textContent).toBe('Attach to');
		const input = await typeQuery('ada');
		expect(search).toHaveBeenCalledWith('t1', 'ada');
		expect(input.getAttribute('aria-expanded')).toBe('true');
		expect(document.querySelector('[role="listbox"]')).not.toBeNull();
		expect(options()).toEqual(['Ada Lovelace', 'p2']);
	});

	it('does not search while the person is still typing', async () => {
		search.mockResolvedValue([]);
		render();
		const input = document.querySelector<HTMLInputElement>('input[role="combobox"]')!;
		input.value = 'a';
		input.dispatchEvent(new Event('input', { bubbles: true }));
		await vi.advanceTimersByTimeAsync(100);
		input.value = 'ad';
		input.dispatchEvent(new Event('input', { bubbles: true }));
		await vi.advanceTimersByTimeAsync(100);
		expect(search).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(300);
		expect(search).toHaveBeenCalledTimes(1);
		expect(search).toHaveBeenCalledWith('t1', 'ad');
	});

	it('chooses a match with a click and reports its id and name', async () => {
		search.mockResolvedValue([{ id: 'p1', givenName: 'Ada', surname: null }]);
		const onpick = render();
		await typeQuery('ada');
		document.querySelector<HTMLLIElement>('[role="option"]')!.click();
		flushSync();
		expect(onpick).toHaveBeenCalledWith({ id: 'p1', name: 'Ada' });
	});

	it('moves the highlight with the arrow keys and chooses it with Enter', async () => {
		search.mockResolvedValue([
			{ id: 'p1', givenName: 'Ada', surname: null },
			{ id: 'p2', givenName: 'Ada', surname: 'Byron' }
		]);
		const onpick = render();
		const input = await typeQuery('ada');
		input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
		flushSync();
		expect(input.getAttribute('aria-activedescendant')).toBe(
			document.querySelectorAll('[role="option"]')[1]!.id
		);
		input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
		flushSync();
		expect(onpick).toHaveBeenCalledWith({ id: 'p2', name: 'Ada Byron' });
		expect(document.querySelector('[role="listbox"]')).toBeNull();
	});

	it('closes the list on Escape without choosing', async () => {
		search.mockResolvedValue([{ id: 'p1', givenName: 'Ada', surname: null }]);
		const onpick = render();
		const input = await typeQuery('ada');
		input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
		flushSync();
		expect(document.querySelector('[role="listbox"]')).toBeNull();
		expect(onpick).not.toHaveBeenCalled();
	});

	it('says when nobody matches and when the search fails', async () => {
		search.mockResolvedValueOnce([]);
		render();
		await typeQuery('zz');
		expect(document.body.textContent).toContain('No matching people');
		search.mockRejectedValueOnce(new Error('down'));
		await typeQuery('zq');
		expect(document.querySelector('[role="alert"]')!.textContent).toContain('Search failed');
	});

	it('ignores an answer to an older query that arrives last', async () => {
		let resolveFirst!: (value: Awaited<ReturnType<typeof searchPeopleApi>>) => void;
		search
			.mockImplementationOnce(() => new Promise((resolve) => (resolveFirst = resolve)))
			.mockResolvedValueOnce([{ id: 'p2', givenName: 'Bea', surname: null }]);
		render();
		await typeQuery('ann');
		await typeQuery('bea');
		resolveFirst([{ id: 'p1', givenName: 'Ann', surname: null }]);
		await vi.advanceTimersByTimeAsync(0);
		flushSync();
		expect(options()).toEqual(['Bea']);
	});
});
