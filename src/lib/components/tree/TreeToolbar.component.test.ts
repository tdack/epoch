import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import { resolvePalette, type Palette } from '#lib/shared/palette.js';
import { DEFAULT_VIEW_STATE } from './tree-url.js';
import TreeToolbar from './TreeToolbar.svelte';

beforeAll(() => {
	vi.stubGlobal('matchMedia', () => ({
		matches: false,
		addEventListener() {},
		removeEventListener() {}
	}));
});

let component: Record<string, unknown> | null = null;
afterEach(() => {
	if (component) unmount(component);
	component = null;
	document.body.innerHTML = '';
});

function render(palette?: Palette) {
	component = mount(TreeToolbar, {
		target: document.body,
		props: {
			view: DEFAULT_VIEW_STATE,
			palette,
			onchangeFocus: vi.fn(),
			onopenProfile: vi.fn(),
			onChange: vi.fn()
		}
	});
	flushSync();
	return document.querySelector<HTMLElement>('[role="toolbar"]')!;
}

describe('TreeToolbar palette', () => {
	it('carries the palette it is given as the tree tokens', () => {
		const palette = resolvePalette({
			sexColours: { male: '#3a6ea5', female: '#b8607f', unknown: '#7d756a' },
			focusColours: { ancestor: '#6b4410', descendant: '#0f766e', partner: '#7c3a72' }
		});
		const root = render(palette);
		expect(root.style.getPropertyValue('--sex-m-border')).toBe('#3a6ea5');
		expect(root.style.getPropertyValue('--sex-m')).toBe(palette.sex.male.fill);
		expect(root.style.getPropertyValue('--union-ink')).toBe('#6b4410');
	});

	it('keeps the built-in colours without one', () => {
		expect(render().style.getPropertyValue('--sex-m-border')).toBe('#5a84b5');
	});
});

describe('TreeToolbar on a tablet', () => {
	it('folds the generation steppers into one button', () => {
		// Only the tablet query matches: the phone layout would hide the steppers altogether.
		vi.stubGlobal('matchMedia', (query: string) => ({
			matches: query.includes('1023px'),
			addEventListener() {},
			removeEventListener() {}
		}));
		const root = render();
		expect(root.querySelector('button[aria-label="More ancestors generations"]')).toBeNull();
		const button = [...root.querySelectorAll('button')].find((b) =>
			b.textContent?.includes('Generations')
		)!;
		expect(button.textContent).toContain(
			`${DEFAULT_VIEW_STATE.ancestorDepth} up, ${DEFAULT_VIEW_STATE.descendantDepth} down`
		);
		button.click();
		flushSync();
		expect(
			document.querySelector('button[aria-label="More ancestors generations"]')
		).not.toBeNull();
	});
});
