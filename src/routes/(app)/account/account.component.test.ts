import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';

vi.mock('$app/navigation', () => ({
	invalidate: vi.fn().mockResolvedValue(undefined),
	invalidateAll: vi.fn().mockResolvedValue(undefined)
}));
// The tree list is the My trees tab; a test may open another.
const page = vi.hoisted(() => ({ url: new URL('https://epoch.test/account#trees') }));
vi.mock('$app/state', () => ({ page }));
vi.mock('#lib/api/settings.js', () => ({
	saveMySettings: vi.fn(),
	saveDefaultTree: vi.fn(),
	saveViewMode: vi.fn().mockResolvedValue(undefined),
	saveHomePerson: vi.fn().mockResolvedValue(undefined),
	saveSelfPerson: vi.fn().mockResolvedValue(undefined)
}));
vi.mock('#lib/api/lists.js', () => ({
	searchPeopleApi: vi.fn().mockResolvedValue([{ id: 'p9', givenName: 'Ada', surname: 'Lovelace' }])
}));

import { saveHomePerson, saveSelfPerson, saveViewMode } from '#lib/api/settings.js';
import Page from './+page.svelte';

let component: Record<string, unknown> | null = null;
afterEach(() => {
	page.url = new URL('https://epoch.test/account#trees');
	if (component) unmount(component);
	component = null;
	document.body.innerHTML = '';
});

function render(
	trees: Array<Record<string, unknown>>,
	leave: Record<string, unknown> = { isInstallOwner: false, soleOwnerTrees: [] },
	homePersonNames: Record<string, string> = {},
	selfPersonNames: Record<string, string> = {}
) {
	component = mount(Page, {
		target: document.body,
		props: {
			data: {
				profile: {
					email: 'a@example.test',
					name: 'Ann',
					avatarUrl: null,
					canUseAccessPicture: false
				},
				leave,
				settings: { user: {}, site: {}, effective: {} },
				trees,
				homePersonNames,
				selfPersonNames
			} as never
		}
	});
	flushSync();
}

const tree = (id: string, name: string, role: string, extra = {}) => ({
	id,
	slug: id,
	name,
	role,
	isDefault: false,
	viewMode: null,
	...extra
});

describe('account page', () => {
	it('lists each tree with the viewer’s role and a Default choice', () => {
		render([tree('a', 'Smiths', 'owner', { isDefault: true }), tree('b', 'Joneses', 'viewer')]);
		const cards = [...document.querySelectorAll('#trees-tab li')];
		expect(cards.map((c) => c.querySelector('h3 a')!.textContent!.trim())).toEqual([
			'Smiths',
			'Joneses'
		]);
		expect(cards.map((c) => c.querySelector('h3 span')!.textContent!.trim())).toEqual([
			'owner',
			'viewer'
		]);
		const radios = [...document.querySelectorAll<HTMLInputElement>('input[name="default-tree"]')];
		expect(radios.map((r) => r.checked)).toEqual([true, false]);
	});

	it('hides the Default choice for a single tree and saves the open-in view on change', async () => {
		render([tree('a', 'Smiths', 'editor')]);
		expect(document.querySelector('input[name="default-tree"]')).toBeNull();
		const select = document.querySelector('#trees-tab select') as unknown as HTMLSelectElement;
		select.value = 'rings';
		select.dispatchEvent(new Event('change', { bubbles: true }));
		await Promise.resolve();
		expect(saveViewMode).toHaveBeenCalledWith('a', 'rings');
	});

	it('names the trees that block leaving and disables Leave until they have another owner', () => {
		page.url = new URL('https://epoch.test/account#leave');
		render([], { isInstallOwner: false, soleOwnerTrees: [{ id: 't1', name: 'Smiths' }] });
		const link = document.querySelector<HTMLAnchorElement>('[data-testid="leave-blocker"] a')!;
		expect(link.textContent).toBe('Smiths');
		expect(link.getAttribute('href')).toBe('/trees/t1/members');
		const leave = [...document.querySelectorAll('button')].find(
			(b) => b.textContent?.trim() === 'Leave Epoch'
		)!;
		expect(leave.disabled).toBe(true);
	});

	it('shows the starting person, or No preference, and saves a pick and a clear', async () => {
		vi.useFakeTimers();
		try {
			render(
				[tree('a', 'Smiths', 'editor', { homePersonId: 'p1' }), tree('b', 'Joneses', 'viewer')],
				undefined,
				{ a: 'Olda Oldman' }
			);
			const placeholders = [
				...document.querySelectorAll<HTMLInputElement>('input[role="combobox"]')
			].map((i) => i.placeholder);
			expect(placeholders).toEqual(['Olda Oldman', 'Not linked', 'No preference', 'Not linked']);

			const input = document.querySelectorAll<HTMLInputElement>('input[role="combobox"]')[2]!;
			input.value = 'ada';
			input.dispatchEvent(new Event('input', { bubbles: true }));
			await vi.advanceTimersByTimeAsync(300);
			flushSync();
			(document.querySelector('[role="option"]') as HTMLElement).click();
			await vi.advanceTimersByTimeAsync(0);
			expect(saveHomePerson).toHaveBeenCalledWith('b', 'p9');

			[...document.querySelectorAll('button')]
				.find((b) => b.textContent?.trim().startsWith('Clear'))!
				.click();
			await vi.advanceTimersByTimeAsync(0);
			expect(saveHomePerson).toHaveBeenCalledWith('a', null);
		} finally {
			vi.useRealTimers();
		}
	});

	it('saves and clears the member’s own person per tree', async () => {
		vi.useFakeTimers();
		try {
			render(
				[tree('a', 'Smiths', 'editor', { selfPersonId: 'p1' }), tree('b', 'Joneses', 'viewer')],
				undefined,
				{},
				{ a: 'Olda Oldman' }
			);
			const boxes = document.querySelectorAll<HTMLInputElement>('input[role="combobox"]');
			expect(boxes[1]!.placeholder).toBe('Olda Oldman');
			const input = boxes[3]!;
			input.value = 'ada';
			input.dispatchEvent(new Event('input', { bubbles: true }));
			await vi.advanceTimersByTimeAsync(300);
			flushSync();
			(document.querySelector('[role="option"]') as HTMLElement).click();
			await vi.advanceTimersByTimeAsync(0);
			expect(saveSelfPerson).toHaveBeenCalledWith('b', 'p9');

			[...document.querySelectorAll('button')]
				.find((b) => b.textContent?.trim().startsWith('Clear'))!
				.click();
			await vi.advanceTimersByTimeAsync(0);
			expect(saveSelfPerson).toHaveBeenCalledWith('a', null);
		} finally {
			vi.useRealTimers();
		}
	});
});
