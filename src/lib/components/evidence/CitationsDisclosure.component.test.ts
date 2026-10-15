import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';
import { CITATION_SUBJECT_KINDS } from '#lib/shared/evidence.js';
import type { TreeRole } from '#lib/shared/roles.js';
import CitationsDisclosure from './CitationsDisclosure.svelte';

vi.mock('#lib/api/evidence.js', async (importOriginal) => ({
	...(await importOriginal<object>()),
	fetchSources: vi.fn(async () => [])
}));

// jsdom has no modal dialogs; the dialog only needs to open and close.
beforeAll(() => {
	HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
		this.open = true;
	};
	HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
		this.open = false;
	};
});

let component: Record<string, unknown> | null = null;
afterEach(() => {
	if (component) unmount(component);
	component = null;
	document.body.innerHTML = '';
});

function render(role: TreeRole | undefined, citationCount = 0) {
	component = mount(CitationsDisclosure, {
		target: document.body,
		props: {
			treeId: 't1',
			role,
			subjectLabel: 'the birth of Ann Ash',
			subject: { kind: CITATION_SUBJECT_KINDS.EVENT, id: 'e1' },
			citations: [],
			citationCount,
			label: 'the birth',
			editor: { afterChange: vi.fn(), refresh: vi.fn() } as never,
			toasts: { push: vi.fn() } as never
		}
	});
	flushSync();
}

const addButton = () =>
	document.querySelector<HTMLButtonElement>(
		'button[aria-label="Add a citation for the birth of Ann Ash"]'
	);

describe('CitationsDisclosure without citations', () => {
	it('makes Unsourced a button that opens the citation dialog for an editor', async () => {
		render('editor');
		const button = addButton();
		expect(button).not.toBeNull();
		expect(button!.textContent).toContain('Unsourced');
		expect(document.querySelector('[data-testid="citation-form"]')).toBeNull();

		button!.click();
		await tick();
		flushSync();
		expect(document.querySelector('[data-testid="citation-form"]')).not.toBeNull();
	});

	it('shows Unsourced as plain text to a viewer, with no way to add a citation', () => {
		render('viewer');
		expect(addButton()).toBeNull();
		expect(document.querySelector('[data-testid="claim-state"]')!.textContent).toContain(
			'Unsourced'
		);
		expect(document.querySelector('[data-testid="add-citation"]')).toBeNull();
	});

	it('shows Unsourced as plain text to the public visitor', () => {
		render(undefined);
		expect(addButton()).toBeNull();
		expect(document.querySelector('[data-testid="claim-state"]')).not.toBeNull();
	});
});

describe('CitationsDisclosure with citations', () => {
	it('shows the sourced marker as the disclosure, not an add button', () => {
		render('editor', 2);
		expect(document.querySelector('[data-testid="add-citation"]')).toBeNull();
		const disclosure = document.querySelector('[data-testid="citations-disclosure"]');
		expect(disclosure?.tagName).toBe('DETAILS');
		expect(document.querySelector('[data-testid="claim-state"]')!.textContent).toContain(
			'2 citations'
		);
	});
});
