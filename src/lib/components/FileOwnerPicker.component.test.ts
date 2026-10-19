import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';

vi.mock('#lib/api/lists.js', () => ({ searchPeopleApi: vi.fn() }));
vi.mock('#lib/api/evidence.js', () => ({ fetchSources: vi.fn(), createSourceApi: vi.fn() }));

import { searchPeopleApi } from '#lib/api/lists.js';
import { fetchSources } from '#lib/api/evidence.js';
import FileOwnerPicker from './FileOwnerPicker.svelte';

const people = vi.mocked(searchPeopleApi);
const sources = vi.mocked(fetchSources);

let component: Record<string, unknown> | null = null;
beforeEach(() => {
	people.mockReset();
	sources.mockReset();
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
	it('offers only people to a role that cannot change evidence', () => {
		render(false);
		expect(button('Source')).toBeUndefined();
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
});
