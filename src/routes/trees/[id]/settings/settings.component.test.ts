import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';

const navigation = vi.hoisted(() => ({ invalidate: vi.fn() }));
vi.mock('$app/navigation', () => navigation);
vi.mock('$app/state', () => ({
	page: { url: new URL('https://epoch.test/trees/smiths/settings') }
}));
const toasts = vi.hoisted(() => ({ push: vi.fn() }));
const context = vi.hoisted(() => ({ followAddress: vi.fn(), exportGedcom: vi.fn() }));
vi.mock('#lib/components/tree/tree-context.js', () => ({
	getTreeContext: () => ({ toasts, ...context })
}));
vi.mock('#lib/api/trees.js', () => ({ renameTreeApi: vi.fn(), deleteTreeApi: vi.fn() }));
vi.mock('#lib/api/people.js', () => ({ savePrivacySettings: vi.fn() }));
vi.mock('#lib/api/subtrees.js', () => ({ deleteSubtree: vi.fn(), updateSubtree: vi.fn() }));
vi.mock('#lib/api/relationships.js', () => ({ undoApi: vi.fn() }));

import { renameTreeApi } from '#lib/api/trees.js';
import { savePrivacySettings } from '#lib/api/people.js';
import Page from './+page.svelte';

const rename = vi.mocked(renameTreeApi);
const savePrivacy = vi.mocked(savePrivacySettings);

let component: Record<string, unknown> | null = null;
beforeEach(() => {
	rename.mockReset().mockResolvedValue({ id: 't1', slug: 'smiths', isOnSubdomain: false });
	savePrivacy
		.mockReset()
		.mockResolvedValue({ maxAliveYears: 100, shouldShowPrivateStructure: true });
	navigation.invalidate.mockReset().mockResolvedValue(undefined);
	context.followAddress.mockReset().mockResolvedValue(undefined);
	toasts.push.mockReset();
});
afterEach(() => {
	if (component) unmount(component);
	component = null;
	document.body.innerHTML = '';
});

interface Options {
	can?: Partial<{ canManageSubtrees: boolean; canExport: boolean; canDelete: boolean }>;
	isInstallOwner?: boolean;
	isTreePublic?: boolean;
	subdomainZone?: string | null;
}

function render({ can = {}, isInstallOwner = false, isTreePublic = false, ...rest }: Options = {}) {
	component = mount(Page, {
		target: document.body,
		props: {
			data: {
				subdomainZone: null,
				hostTree: null,
				...rest,
				privacy: { maxAliveYears: 100, shouldShowPrivateStructure: false },
				subtrees: [],
				rootNames: {},
				canManageSubtrees: true,
				canExport: true,
				canDelete: false,
				...can,
				summary: {
					tree: { id: 't1', slug: 'smiths', name: 'Smiths', version: 3, isOnSubdomain: false },
					viewer: { isInstallOwner, isTreePublic }
				}
			}
		} as never
	});
	flushSync();
}

const sections = () => [...document.querySelectorAll('section[id]')].map((s) => s.id);
const nameOf = (id: string) =>
	document.getElementById(document.getElementById(id)!.getAttribute('aria-labelledby')!)!
		.textContent;

async function submit(form: HTMLFormElement) {
	form.requestSubmit();
	await tick();
	await Promise.resolve();
	await tick();
}

describe('tree settings page', () => {
	it('shows every section to an owner, each named by its heading', () => {
		render({ can: { canDelete: true } });
		expect(sections()).toEqual([
			'general',
			'address',
			'visibility',
			'subtrees',
			'export',
			'delete'
		]);
		expect(nameOf('delete')).toBe('Delete this tree');
		expect(document.querySelector('h2')!.textContent).toBe('Tree settings');
		expect(document.body.textContent).toContain('apply to everyone in Smiths');
	});

	it('leaves out the sections the viewer cannot use', () => {
		render({ can: { canManageSubtrees: false, canExport: false, canDelete: false } });
		expect(sections()).toEqual(['general', 'address', 'visibility']);
	});

	it('says whether the tree is public, and offers the install owner only the link to change it', () => {
		render({ isTreePublic: true });
		expect(document.getElementById('visibility')!.textContent).toContain(
			'This tree is public: anyone with the link can read it.'
		);
		expect(document.querySelector('a[href="/admin#trees"]')).toBeNull();
		unmount(component!);
		document.body.innerHTML = '';
		render({ isInstallOwner: true });
		expect(document.getElementById('visibility')!.textContent).toContain('Not public');
		expect(document.querySelector('a[href="/admin#trees"]')).not.toBeNull();
	});

	it('hides the subdomain choice where the install serves none', () => {
		render();
		expect(document.getElementById('tree-subdomain-help')).toBeNull();
		unmount(component!);
		document.body.innerHTML = '';
		render({ subdomainZone: 'epoch.test' });
		expect(document.getElementById('tree-subdomain-help')!.textContent).toContain(
			'Its name becomes visible as a web address'
		);
	});

	it('saves a new name with the address as it stands, then reloads in place', async () => {
		render();
		const input = document.getElementById('tree-name') as HTMLInputElement;
		input.value = 'The Smiths';
		input.dispatchEvent(new Event('input', { bubbles: true }));
		flushSync();
		await submit(input.closest('form')!);
		expect(rename).toHaveBeenCalledWith('t1', 'The Smiths', 'smiths', 3, undefined);
		expect(toasts.push).toHaveBeenCalledWith('Tree saved');
		expect(navigation.invalidate).toHaveBeenCalled();
	});

	it('sends nothing when the address is unchanged, and refuses a malformed one', async () => {
		render();
		const slug = document.getElementById('tree-slug') as HTMLInputElement;
		await submit(slug.closest('form')!);
		expect(rename).not.toHaveBeenCalled();
		slug.value = 'Not A Slug';
		slug.dispatchEvent(new Event('input', { bubbles: true }));
		flushSync();
		await submit(slug.closest('form')!);
		expect(rename).not.toHaveBeenCalled();
		expect(document.querySelector('[role="alert"]')!.textContent).toContain('lower-case letters');
	});

	it('moves the page when the address changes', async () => {
		rename.mockResolvedValue({ id: 't1', slug: 'the-smiths', isOnSubdomain: false });
		render();
		const slug = document.getElementById('tree-slug') as HTMLInputElement;
		slug.value = 'the-smiths';
		slug.dispatchEvent(new Event('input', { bubbles: true }));
		flushSync();
		await submit(slug.closest('form')!);
		expect(rename).toHaveBeenCalledWith('t1', 'Smiths', 'the-smiths', 3, undefined);
		expect(context.followAddress).toHaveBeenCalledWith({
			id: 't1',
			slug: 'the-smiths',
			isOnSubdomain: false
		});
	});

	it('saves the "Private" placeholder choice as soon as it is ticked', async () => {
		render();
		const box = document.querySelector<HTMLInputElement>('#visibility input[type="checkbox"]')!;
		box.click();
		await tick();
		await Promise.resolve();
		expect(savePrivacy).toHaveBeenCalledWith('t1', { shouldShowPrivateStructure: true });
		expect(toasts.push).toHaveBeenCalledWith('Hidden people now show as Private');
	});
});
