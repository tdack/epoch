import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';
import type { WebGlTreeScene } from './webgl-tree.js';
import WebGlTreeShell from './WebGlTreeShell.svelte';

let component: Record<string, unknown> | null = null;
afterEach(() => {
	if (component) unmount(component);
	component = null;
	document.body.innerHTML = '';
	vi.unstubAllGlobals();
});

function fakeScene(): WebGlTreeScene {
	return {
		setCamera: vi.fn(),
		setSpinning: vi.fn(),
		pick: () => null,
		project: () => null,
		targets: () => [],
		onFrame: vi.fn(),
		requestFrame: vi.fn(),
		dispose: vi.fn()
	};
}

async function render(isOsReducing: boolean, isMotionReduced: boolean) {
	vi.stubGlobal('matchMedia', () => ({
		matches: isOsReducing,
		addEventListener() {},
		removeEventListener() {}
	}));
	vi.stubGlobal(
		'ResizeObserver',
		class {
			observe() {}
			unobserve() {}
			disconnect() {}
		}
	);
	component = mount(WebGlTreeShell, {
		target: document.body,
		props: {
			people: [],
			kin: { people: [], unions: [], links: [] } as never,
			focusPersonId: null,
			label: 'Test view',
			viewName: 'Test',
			subject: 'the test',
			announcement: '',
			fitKey: 'k',
			cameras: [{ id: 'a', label: 'Angled' }],
			createScene: async () => fakeScene(),
			applyLayout: vi.fn(),
			isMotionReduced
		}
	});
	flushSync();
	await tick();
}

const spin = () =>
	[...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Spin');

describe('WebGlTreeShell reduced motion', () => {
	it.each([
		[false, false, true],
		[true, false, false],
		[false, true, false],
		[true, true, false]
	])('system %s, setting %s: Spin offered %s', async (isOs, isUser, isOffered) => {
		await render(isOs, isUser);
		expect(spin() !== undefined).toBe(isOffered);
	});
});
