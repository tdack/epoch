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
	saveViewMode: vi.fn().mockResolvedValue(undefined)
}));

import { saveViewMode } from '#lib/api/settings.js';
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
	leave: Record<string, unknown> = { isInstallOwner: false, soleOwnerTrees: [] }
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
				trees
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
		const rows = [...document.querySelectorAll('#trees-tab tbody tr')];
		expect(rows.map((r) => r.querySelector('th')!.textContent!.trim())).toEqual([
			'Smiths',
			'Joneses'
		]);
		expect(rows.map((r) => r.querySelectorAll('td')[0]!.textContent!.trim())).toEqual([
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
});
