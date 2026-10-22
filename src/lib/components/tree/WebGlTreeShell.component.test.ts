import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';
import type { ShellPerson, WebGlTreeScene } from './webgl-tree.js';
import type { TreeEditActions } from './tree-actions.js';
import WebGlTreeShell from './WebGlTreeShell.svelte';

let component: Record<string, unknown> | null = null;
afterEach(() => {
	if (component) unmount(component);
	component = null;
	document.body.innerHTML = '';
	vi.unstubAllGlobals();
});

function fakeScene(pickId: string | null = null): WebGlTreeScene {
	return {
		setCamera: vi.fn(),
		setSpinning: vi.fn(),
		pick: () => (pickId ? { kind: 'person', id: pickId } : null),
		project: () => ({ x: 100, y: 100, scale: 1, isBehind: false }) as never,
		targets: () => (pickId ? [{ kind: 'person', id: pickId }] : []) as never,
		onFrame: vi.fn(),
		requestFrame: vi.fn(),
		dispose: vi.fn()
	};
}

async function render(
	isOsReducing: boolean,
	isMotionReduced: boolean,
	extra: Record<string, unknown> = {}
) {
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
			isMotionReduced,
			...extra
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

describe('WebGlTreeShell person menu', () => {
	const person = (id: string, isPrivate = false): ShellPerson =>
		({
			id,
			generation: 0,
			person: { id, displayName: `Name ${id}`, isPrivate, unionIds: [] }
		}) as never;
	const openMenu = async (people: ShellPerson[], extra: Record<string, unknown> = {}) => {
		const onEditPerson = vi.fn();
		await render(false, false, {
			people,
			scene: null,
			actions: { onEditPerson, onOpenPerson: vi.fn() } satisfies TreeEditActions,
			createScene: async () => fakeScene('p1'),
			...extra
		});
		return onEditPerson;
	};
	const host = () => document.querySelector<HTMLElement>('.webgl-shell > div')!;
	const press = (type: string, button: number, x: number, y: number) =>
		host().dispatchEvent(new MouseEvent(type, { button, clientX: x, clientY: y, bubbles: true }));
	const menu = () => document.querySelector('[role="menu"]');

	it('opens on a right-button click and offers the flat labels', async () => {
		await openMenu([person('p1')]);
		press('pointerdown', 2, 50, 50);
		press('pointerup', 2, 50, 50);
		flushSync();
		expect(menu()?.textContent).toContain('Show details');
		expect(menu()?.textContent).toContain('Edit person');
	});

	it('does not open after a right-drag', async () => {
		await openMenu([person('p1')]);
		press('pointerdown', 2, 50, 50);
		press('pointerup', 2, 80, 50);
		flushSync();
		expect(menu()).toBeNull();
	});

	it('opens from a name tag and gives Escape to the menu alone', async () => {
		const onClearSelection = vi.fn();
		await openMenu([person('p1')], { selectedPersonId: 'p1', onClearSelection });
		await tick();
		document
			.querySelector('button.tag')!
			.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
		flushSync();
		expect(menu()).not.toBeNull();
		document.activeElement!.dispatchEvent(
			new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
		);
		flushSync();
		expect(menu()).toBeNull();
		expect(onClearSelection).not.toHaveBeenCalled();
	});

	it('gives a private person no menu', async () => {
		await openMenu([person('p1', true)]);
		press('pointerdown', 2, 50, 50);
		press('pointerup', 2, 50, 50);
		flushSync();
		expect(menu()).toBeNull();
	});
});
