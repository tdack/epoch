import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import TreeNav from './TreeNav.svelte';

let component: Record<string, unknown> | null = null;
afterEach(() => {
	if (component) unmount(component);
	component = null;
	document.body.innerHTML = '';
});

function render(props: Record<string, unknown>) {
	component = mount(TreeNav, {
		target: document.body,
		props: { treeId: 't1', pathname: '/trees/t1', ...props }
	});
	flushSync();
}

function openMore() {
	const trigger = document.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')!;
	trigger.click();
	flushSync();
	return trigger;
}

const menuLabels = () =>
	[...document.querySelectorAll('[role="menuitem"]')].map((el) => el.textContent?.trim());

describe('TreeNav', () => {
	it('shows four tabs and keeps the rest in the More menu', () => {
		render({ role: 'editor' });
		const tabs = [...document.querySelectorAll('nav > div a')].map((a) => a.textContent?.trim());
		expect(tabs).toEqual(['Tree', 'People', 'Partnerships', 'Places']);
		openMore();
		expect(menuLabels()).toEqual([
			'Sources',
			'Notes',
			'Tasks',
			'Relationship',
			'Surnames',
			'Quality',
			'Fact search',
			'Files',
			'Audit log'
		]);
		expect(document.querySelector('[role="group"][aria-label="Manage"]')).not.toBeNull();
	});

	it('names Sources as the active section on its pages, including a single source', () => {
		for (const pathname of ['/trees/t1/sources', '/trees/t1/sources/s9']) {
			render({ role: 'editor', pathname });
			const trigger = document.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')!;
			expect(trigger.textContent).toContain('More: Sources');
			unmount(component!);
			component = null;
			document.body.innerHTML = '';
		}
	});

	it('offers Files to every member, and to no one outside the tree', () => {
		for (const role of ['viewer', 'contributor', 'editor', 'manager', 'owner']) {
			render({ role });
			openMore();
			expect(menuLabels()).toContain('Files');
			unmount(component!);
			component = null;
			document.body.innerHTML = '';
		}
		render({ role: 'viewer', isOutsider: true });
		openMore();
		expect(menuLabels()).not.toContain('Files');
		unmount(component!);
		component = null;
		document.body.innerHTML = '';
		// A signed-in user with no membership of this tree, and no outsider role, sees no Manage links.
		render({});
		openMore();
		expect(menuLabels()).not.toContain('Files');
	});

	it('offers the Audit log to editors and above only', () => {
		for (const role of ['editor', 'manager', 'owner']) {
			render({ role });
			openMore();
			expect(menuLabels()).toContain('Audit log');
			unmount(component!);
			component = null;
			document.body.innerHTML = '';
		}
		for (const role of ['viewer', 'contributor']) {
			render({ role });
			openMore();
			expect(menuLabels()).not.toContain('Audit log');
			unmount(component!);
			component = null;
			document.body.innerHTML = '';
		}
		render({ role: 'editor', isOutsider: true });
		openMore();
		expect(menuLabels()).not.toContain('Audit log');
	});

	it('names Files as the active section on its page', () => {
		render({ role: 'editor', pathname: '/trees/t1/files' });
		const trigger = document.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')!;
		expect(trigger.textContent).toContain('More: Files');
	});

	it('offers Members and Privacy to managers and owners only', () => {
		for (const role of ['manager', 'owner']) {
			render({ role });
			openMore();
			expect(menuLabels()).toEqual(expect.arrayContaining(['Members', 'Privacy']));
			unmount(component!);
			component = null;
			document.body.innerHTML = '';
		}
		render({ role: 'viewer' });
		openMore();
		expect(menuLabels()).not.toContain('Members');
		expect(menuLabels()).not.toContain('Privacy');
	});

	it('offers Trees to the install owner and to members of more than one tree', () => {
		for (const props of [{ isInstallOwner: true, treeCount: 1 }, { treeCount: 2 }]) {
			render({ role: 'viewer', ...props });
			openMore();
			expect(menuLabels()).toContain('Trees');
			unmount(component!);
			component = null;
			document.body.innerHTML = '';
		}
		render({ role: 'owner', treeCount: 1 });
		openMore();
		expect(menuLabels()).not.toContain('Trees');
	});

	it('no longer carries Settings or Sign out: the avatar menu in the header does', () => {
		render({ role: 'viewer' });
		openMore();
		expect(menuLabels()).not.toContain('Settings');
		expect(menuLabels()).not.toContain('Sign out');
	});

	it('marks Trees active on its page', () => {
		render({ role: 'viewer', treeCount: 2, pathname: '/trees/t1/trees' });
		expect(document.querySelector('button[aria-haspopup="menu"]')!.textContent).toContain(
			'More: Trees'
		);
	});

	it('names the page inside More on the trigger and styles it active', () => {
		render({ role: 'editor', pathname: '/trees/t1/quality' });
		const trigger = document.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')!;
		expect(trigger.textContent).toContain('More: Quality');
		expect(trigger.className).toContain('bg-emerald-800');
	});

	it('closes on Escape and hands focus back to the trigger', async () => {
		render({ role: 'editor' });
		const trigger = openMore();
		const first = document.querySelector<HTMLElement>('[role="menuitem"]')!;
		// The popover moves focus into the menu once it has rendered.
		await vi.waitFor(() => expect(document.activeElement).toBe(first));
		first.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
		flushSync();
		expect(document.querySelector('[role="menu"]')).toBeNull();
		expect(document.activeElement).toBe(trigger);
	});

	it('hands focus back to the trigger after an item is chosen', async () => {
		render({ role: 'editor' });
		const trigger = openMore();
		const first = document.querySelector<HTMLAnchorElement>('[role="menuitem"]')!;
		await vi.waitFor(() => expect(document.activeElement).toBe(first));
		// jsdom cannot navigate; the click must still reach the Popover's handler.
		first.addEventListener('click', (event) => event.preventDefault());
		first.click();
		flushSync();
		expect(document.querySelector('[role="menu"]')).toBeNull();
		expect(document.activeElement).toBe(trigger);
	});
});
