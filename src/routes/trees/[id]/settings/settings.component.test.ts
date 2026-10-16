import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';
import type { SettingsView } from '#lib/shared/settings.js';

const navigation = vi.hoisted(() => ({ invalidate: vi.fn() }));
vi.mock('$app/navigation', () => navigation);
vi.mock('#lib/api/settings.js', () => ({
	saveMySettings: vi.fn(),
	saveSiteSettings: vi.fn()
}));

import { saveMySettings, saveSiteSettings } from '#lib/api/settings.js';
import Page from './+page.svelte';

const saveMine = vi.mocked(saveMySettings);
const saveSite = vi.mocked(saveSiteSettings);

const SITE_SEX = { male: '#3a6ea5', female: '#b8607f', unknown: '#7d756a' };

function view(overrides: Partial<SettingsView> = {}): SettingsView {
	return {
		user: {},
		site: { sexColours: SITE_SEX },
		effective: {
			sexColours: SITE_SEX,
			tracePalette: {
				trace: ['#e69f00', '#00a57a', '#d55e00', '#f0e442', '#7b5fd1', '#2f6fd0'],
				intersection: '#c026d3'
			},
			focusColours: { ancestor: '#8a5a14', descendant: '#0f766e', partner: '#7c3a72' },
			isMotionReduced: false
		},
		...overrides
	};
}

let component: Record<string, unknown> | null = null;
beforeEach(() => {
	saveMine.mockReset().mockResolvedValue(view());
	saveSite.mockReset().mockResolvedValue(view());
	navigation.invalidate.mockReset().mockResolvedValue(undefined);
});
afterEach(() => {
	if (component) unmount(component);
	component = null;
	document.body.innerHTML = '';
});

function render(settings = view(), isInstallOwner = false) {
	component = mount(Page, {
		target: document.body,
		props: {
			data: {
				settings,
				summary: {
					tree: { id: 't1', slug: 'smiths', name: 'Smiths' },
					viewer: { isInstallOwner }
				}
			} as never
		}
	});
	flushSync();
}

const field = (id: string) => document.getElementById(id) as HTMLInputElement;
function type(id: string, value: string) {
	const input = field(id);
	input.value = value;
	input.dispatchEvent(new Event('input', { bubbles: true }));
	flushSync();
}
const button = (name: string, within: Element | Document = document) =>
	[...within.querySelectorAll('button')].find((b) => b.textContent?.trim().startsWith(name))!;
async function submit(form: HTMLFormElement) {
	form.requestSubmit();
	await tick();
	await Promise.resolve();
	await tick();
}

describe('settings page', () => {
	it('labels every colour, shows the inherited site default and contrast figures as text', () => {
		render();
		for (const label of ['Male', 'Female', 'Unknown or other', 'Trace 1', 'Ancestor line'])
			expect(document.querySelector(`label[for="mine-${idOf(label)}-text"]`)?.textContent).toBe(
				label
			);
		expect(field('mine-sex-male-text').value).toBe('#3a6ea5');
		expect(field('mine-sex-male-picker').getAttribute('aria-label')).toBe(
			'Male: choose with a colour picker'
		);
		const hint = document.getElementById(
			field('mine-sex-male-text').getAttribute('aria-describedby')!
		)!;
		expect(hint.textContent).toMatch(/Border on fill \d+\.\d:1 \(needs 3:1\)/);
		expect(document.getElementById('mine-sexColours-status')!.textContent).toContain(
			'Using the site default'
		);
		expect(document.body.textContent).not.toContain('Site default');
		expect(document.querySelectorAll('fieldset legend').length).toBe(3);
	});

	it('saves a changed colour as its whole group and repaints the app', async () => {
		render();
		type('mine-sex-male-text', '#4A86C8');
		expect(document.getElementById('mine-sexColours-status')!.textContent).toContain(
			'Your own colours'
		);
		await submit(document.querySelector('form')!);
		expect(saveMine).toHaveBeenCalledWith({
			sexColours: { ...SITE_SEX, male: '#4a86c8' },
			tracePalette: null,
			focusColours: null
		});
		expect(navigation.invalidate).toHaveBeenCalledWith('app:settings');
	});

	it('keeps text that is not a colour, marked invalid, without changing the colour', () => {
		render();
		type('mine-sex-female-text', 'pink');
		const input = field('mine-sex-female-text');
		expect(input.getAttribute('aria-invalid')).toBe('true');
		const error = document.getElementById('mine-sex-female-error')!;
		expect(input.getAttribute('aria-describedby')).toContain(error.id);
		expect(error.textContent).toContain('six hex digits');
		expect(field('mine-sex-female-picker').value).toBe('#b8607f');
	});

	it('marks a colour that breaks a floor and refuses to send it', async () => {
		render();
		type('mine-sex-male-text', '#ffff00');
		const error = document.getElementById('mine-sex-male-error')!;
		expect(error.textContent).toContain('Male: the card border is too close to its fill');
		expect(field('mine-sex-male-text').getAttribute('aria-invalid')).toBe('true');
		await submit(document.querySelector('form')!);
		expect(saveMine).not.toHaveBeenCalled();
		expect(document.querySelector('[role="alert"]')!.textContent).toContain('too hard to read');
	});

	it('clears one group back to the site default', async () => {
		render(
			view({
				user: {
					focusColours: { ancestor: '#6b4410', descendant: '#0f766e', partner: '#7c3a72' }
				}
			})
		);
		expect(field('mine-focus-ancestor-text').value).toBe('#6b4410');
		button('Use the site default', document.querySelectorAll('fieldset')[2]).click();
		flushSync();
		expect(field('mine-focus-ancestor-text').value).toBe('#8a5a14');
		await submit(document.querySelector('form')!);
		expect(saveMine).toHaveBeenCalledWith({
			sexColours: null,
			tracePalette: null,
			focusColours: null
		});
	});

	it('fills every group from a preset, and resets them all', () => {
		render();
		button('Colour-blind safe').click();
		flushSync();
		expect(field('mine-sex-male-text').value).toBe('#0072b2');
		expect(field('mine-trace-2-text').value).toBe('#56b4e9');
		button('Reset all to the site default').click();
		flushSync();
		expect(field('mine-sex-male-text').value).toBe('#3a6ea5');
	});

	it('shows what the server refused', async () => {
		saveMine.mockRejectedValue(new Error('Female: the sphere is too dark'));
		render();
		type('mine-sex-male-text', '#4a86c8');
		await submit(document.querySelector('form')!);
		await vi.waitFor(() =>
			expect(document.getElementById('mine-save-error')!.textContent).toContain(
				'Female: the sphere is too dark'
			)
		);
	});

	it('gives the install owner the site default too, saved to its own endpoint', async () => {
		render(view(), true);
		expect(document.body.textContent).toContain('Site default');
		expect(field('site-sex-male-text').value).toBe('#3a6ea5');
		type('site-sex-male-text', '#4a86c8');
		await submit(document.querySelectorAll('form')[1]);
		expect(saveSite).toHaveBeenCalledWith(
			expect.objectContaining({ sexColours: { ...SITE_SEX, male: '#4a86c8' } })
		);
		expect(saveMine).not.toHaveBeenCalled();
	});

	it('saves Reduce animation on change, and clears it rather than storing off', async () => {
		render();
		const box = document.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
		expect(box.closest('label')!.textContent).toContain('Reduce animation');
		expect(box.checked).toBe(false);
		box.click();
		await tick();
		expect(saveMine).toHaveBeenLastCalledWith({ isMotionReduced: true });
		expect(navigation.invalidate).toHaveBeenCalledWith('app:settings');
		await vi.waitFor(() => expect(box.disabled).toBe(false));
		expect(box.checked).toBe(true);
		box.click();
		await tick();
		expect(saveMine).toHaveBeenLastCalledWith({ isMotionReduced: null });
	});

	it('points at the Trees page for the default tree', () => {
		render();
		const link = [...document.querySelectorAll('a')].find((a) => a.textContent === 'Trees page')!;
		expect(link.getAttribute('href')).toBe('/trees/smiths/trees');
	});
});

function idOf(label: string): string {
	const ids: Record<string, string> = {
		Male: 'sex-male',
		Female: 'sex-female',
		'Unknown or other': 'sex-unknown',
		'Trace 1': 'trace-0',
		'Ancestor line': 'focus-ancestor'
	};
	return ids[label];
}
