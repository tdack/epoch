import { afterEach, describe, expect, it } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import AvatarMenu from './AvatarMenu.svelte';

let component: Record<string, unknown> | null = null;
afterEach(() => {
	if (component) unmount(component);
	component = null;
	document.body.innerHTML = '';
});

function render(viewer: { name: string | null; avatarUrl: string | null }) {
	component = mount(AvatarMenu, {
		target: document.body,
		props: {
			viewer: { email: 'troy@dack.com.au', canUseAccessPicture: false, ...viewer },
			profileHref: '/trees/t1/profile',
			settingsHref: '/trees/t1/settings',
			signOutHref: '/cdn-cgi/access/logout?returnTo=x'
		}
	});
	flushSync();
}

describe('AvatarMenu', () => {
	it('shows initials on the trigger, and Profile, Settings and Sign out when opened', () => {
		render({ name: 'Troy Dack', avatarUrl: null });
		const trigger = document.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')!;
		expect(trigger.getAttribute('aria-label')).toBe('Account menu');
		expect(trigger.textContent?.trim()).toBe('TD');
		trigger.click();
		flushSync();
		const items = [...document.querySelectorAll<HTMLAnchorElement>('[role="menuitem"]')];
		expect(items.map((a) => [a.textContent?.trim(), a.getAttribute('href')])).toEqual([
			['Profile', '/trees/t1/profile'],
			['Settings', '/trees/t1/settings'],
			['Sign out', '/cdn-cgi/access/logout?returnTo=x']
		]);
		expect(items[2].hasAttribute('data-sveltekit-reload')).toBe(true);
	});

	it('shows the picture, labelled, when there is one, and the email initial with no name', () => {
		render({ name: null, avatarUrl: '/api/profile/avatar/u1?v=1' });
		const img = document.querySelector('img')!;
		expect(img.getAttribute('src')).toBe('/api/profile/avatar/u1?v=1');
		expect(img.getAttribute('alt')).toBe('Picture of troy@dack.com.au');
		img.dispatchEvent(new Event('error'));
		flushSync();
		expect(document.querySelector('img')).toBeNull();
		expect(document.querySelector('[role="img"]')?.textContent?.trim()).toBe('T');
	});
});
