import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';

vi.mock('#lib/api/lists.js', () => ({ searchPeopleApi: vi.fn() }));
vi.mock('#lib/api/evidence.js', () => ({
	fetchSources: vi.fn(),
	fetchUnions: vi.fn(),
	createSourceApi: vi.fn()
}));

import { searchPeopleApi } from '#lib/api/lists.js';
import { fetchSources, fetchUnions } from '#lib/api/evidence.js';
import FileOwnerPicker from './FileOwnerPicker.svelte';

const people = vi.mocked(searchPeopleApi);
const sources = vi.mocked(fetchSources);
const unions = vi.mocked(fetchUnions);

let component: Record<string, unknown> | null = null;
beforeEach(() => {
	people.mockReset();
	sources.mockReset();
	unions.mockReset();
});
afterEach(() => {
	if (component) unmount(component);
	component = null;
	document.body.innerHTML = '';
});

/** Mounts the picker and returns what it last reported as chosen. */
function render(canPickSource: boolean) {
	const state = { picked: null as { id: string; name: string } | null };
	component = mount(FileOwnerPicker, {
		target: document.body,
		props: {
			treeId: 't1',
			idPrefix: 'test',
			canPickSource,
			get picked() {
				return state.picked;
			},
			set picked(value: { id: string; name: string } | null) {
				state.picked = value;
			}
		}
	});
	flushSync();
	return state;
}

const button = (name: string) =>
	[...document.querySelectorAll<HTMLButtonElement>('button')].find(
		(b) => b.textContent?.trim() === name
	);

function offerOneSource() {
	sources.mockResolvedValue({
		items: [{ id: 's1', title: 'Parish register', author: null }]
	} as never);
}

describe('FileOwnerPicker', () => {
	it('offers people and partnerships, but no sources, to a role that cannot change evidence', () => {
		render(false);
		expect(button('Source')).toBeUndefined();
		expect(button('Partnership')).toBeDefined();
		expect(document.querySelector('input[role="combobox"]')).not.toBeNull();
	});

	it('switches to a source search and reports the source chosen', async () => {
		offerOneSource();
		const state = render(true);
		button('Source')!.click();
		flushSync();
		expect(button('Source')!.getAttribute('aria-pressed')).toBe('true');
		await vi.waitFor(() => expect(document.querySelector('[role="option"]')).not.toBeNull());
		document.querySelector<HTMLElement>('[role="option"]')!.click();
		flushSync();
		expect(state.picked).toEqual({ id: 's1', name: 'Parish register' });
	});

	it('forgets a chosen source when the choice goes back to people', async () => {
		offerOneSource();
		const state = render(true);
		button('Source')!.click();
		flushSync();
		await vi.waitFor(() => expect(document.querySelector('[role="option"]')).not.toBeNull());
		document.querySelector<HTMLElement>('[role="option"]')!.click();
		flushSync();
		button('Person')!.click();
		flushSync();
		expect(state.picked).toBeNull();
		expect(document.querySelector('[data-testid="chosen-source"]')).toBeNull();
	});

	it('lists partnerships by their partners and reports the one chosen', async () => {
		unions.mockResolvedValue({
			items: [
				{ id: 'u1', partners: [{ displayName: 'Ann' }, { displayName: 'Bob' }] },
				{ id: 'u2', partners: [] }
			],
			hasMore: false
		} as never);
		const state = render(false);
		button('Partnership')!.click();
		flushSync();
		await vi.waitFor(() => expect(document.querySelectorAll('option').length).toBe(3));
		expect([...document.querySelectorAll('option')].map((o) => o.textContent)).toEqual([
			'Choose a partnership',
			'Ann & Bob',
			'Partnership'
		]);
		const select = document.querySelector('select')!;
		select.value = 'u1';
		select.dispatchEvent(new Event('change', { bubbles: true }));
		flushSync();
		expect(state.picked).toEqual({ id: 'u1', name: 'Ann & Bob' });
	});
});
