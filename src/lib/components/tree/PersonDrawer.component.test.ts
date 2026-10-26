import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import type { PersonPageDto } from '#lib/shared/person-page.js';
import PersonDrawer from './PersonDrawer.svelte';

// The drawer sits under a tree layout in the app; this test mounts it bare, so the layout's context is stubbed.
vi.mock('#lib/components/tree/tree-context.js', () => ({
	getTreeContext: () => ({ toasts: { push: () => {} } })
}));

let component: Record<string, unknown> | null = null;
afterEach(() => {
	if (component) unmount(component);
	component = null;
	document.body.innerHTML = '';
});

const page = {
	isPrivate: false,
	privacy: null,
	person: {
		id: 'ben',
		displayName: 'Ben',
		sex: 'U',
		xrefId: null,
		version: 1,
		givenName: 'Ben',
		surname: null,
		isDeceased: false
	},
	names: [],
	vitals: { birth: null, death: null, lifespan: null, hasConflict: false },
	facts: [],
	parentFamilies: [],
	partnerships: [],
	directChildren: [],
	siblings: { full: [], half: [] },
	stepParents: [],
	stepChildren: [],
	associations: [],
	media: [],
	notes: [],
	linkNotes: [],
	tasks: { items: [], members: [] },
	evidence: { citations: [], links: [] },
	changes: { recent: [], createdAt: null, updatedAt: null }
} as unknown as PersonPageDto;

function open(props: Record<string, unknown> = {}) {
	const onClose = vi.fn();
	component = mount(PersonDrawer, {
		target: document.body,
		props: {
			page,
			treeId: 't',
			role: 'owner',
			onClose,
			onSelectPerson: vi.fn(),
			editor: { openRelationship: vi.fn(), anchorFor: (id: string) => ({ id }) } as never,
			toasts: { push: vi.fn() } as never,
			marks: { favorites: [] } as never,
			...props
		}
	});
	flushSync();
	return { onClose };
}

describe('PersonDrawer frame', () => {
	it('links to the full page and closes from its button', () => {
		const { onClose } = open();
		expect(document.querySelector('a[href="/trees/t/people/ben"]')).not.toBeNull();
		document.querySelector<HTMLButtonElement>('button[aria-label="Close details"]')!.click();
		expect(onClose).toHaveBeenCalledOnce();
	});

	it('closes on Escape, but not on the Escape that closes a dialog inside it', () => {
		const { onClose } = open();
		const heading = document.querySelector('h2')!;
		const dialog = document.createElement('dialog');
		const inside = document.createElement('button');
		dialog.appendChild(inside);
		heading.parentElement!.appendChild(dialog);
		inside.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
		expect(onClose).not.toHaveBeenCalled();
		heading.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
		expect(onClose).toHaveBeenCalledOnce();
	});

	it('moves focus to the person’s heading when it opens', async () => {
		open();
		await Promise.resolve();
		await Promise.resolve();
		expect(document.activeElement).toBe(document.querySelector('h2'));
	});

	it('docks in the page flow and widens from its handle', () => {
		vi.stubGlobal('innerWidth', 1440);
		open({ isDocked: true });
		const panel = document.querySelector<HTMLElement>('[aria-label="Person details"]')!;
		expect(panel.classList.contains('fixed')).toBe(false);
		const handle = document.querySelector<HTMLElement>('[role="separator"]')!;
		const before = Number(handle.getAttribute('aria-valuenow'));
		handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
		flushSync();
		expect(Number(handle.getAttribute('aria-valuenow'))).toBeGreaterThan(before);
		vi.unstubAllGlobals();
	});

	it('says why it could not load', () => {
		open({ page: null, error: 'Person not found' });
		expect(document.querySelector('[role="alert"]')!.textContent).toContain('Person not found');
	});
});
