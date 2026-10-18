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

function render(
	role: TreeRole | undefined,
	citationCount = 0,
	extra: Record<string, unknown> = {}
) {
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
			toasts: { push: vi.fn() } as never,
			...extra
		}
	});
	flushSync();
}

const addButton = () =>
	document.querySelector<HTMLButtonElement>(
		'button[aria-label="Add a source for the birth of Ann Ash"]'
	);

describe('CitationsDisclosure without citations', () => {
	it('shows nothing at all: no word, no marker, and no empty line', () => {
		render('viewer');
		expect(document.body.textContent?.trim()).toBe('');
		expect(document.querySelector('[data-testid="claim-state"]')).toBeNull();
		expect(document.querySelector('[data-testid="add-citation"]')).toBeNull();
		// The line stays in the DOM but is hidden by CSS while nothing sits on it.
		expect(document.body.firstElementChild?.children).toHaveLength(0);
	});

	it('shows nothing to the public visitor', () => {
		render(undefined);
		expect(document.body.textContent?.trim()).toBe('');
	});

	it('offers a quiet Add source link to a role that can cite, opening the dialog', async () => {
		render('contributor');
		const button = addButton();
		expect(button).not.toBeNull();
		expect(button!.textContent).toBe('Add source');
		expect(document.querySelector('[data-testid="citation-form"]')).toBeNull();

		button!.click();
		await tick();
		flushSync();
		expect(document.querySelector('[data-testid="citation-form"]')).not.toBeNull();
	});

	it('leaves the link out where an edit dialog is the way in', () => {
		render('editor', 0, { isAddLinkShown: false });
		expect(addButton()).toBeNull();
	});
});

describe('CitationsDisclosure with citations', () => {
	it('shows a quote icon and the count as the disclosure, named by count and subject', () => {
		render('editor', 2);
		expect(document.querySelector('[data-testid="add-citation"]')).toBeNull();
		const disclosure = document.querySelector('[data-testid="citations-disclosure"]');
		expect(disclosure?.tagName).toBe('DETAILS');
		const summary = disclosure!.querySelector('summary')!;
		expect(summary.getAttribute('aria-label')).toBe('2 citations for the birth');
		expect(summary.textContent?.trim()).toBe('2');
		expect(summary.textContent).not.toMatch(/sourced/i);
	});

	it('says citation in the singular for one', () => {
		render('viewer', 1);
		expect(document.querySelector('summary')!.getAttribute('aria-label')).toBe(
			'1 citation for the birth'
		);
	});
});

describe('CitationsDisclosure when conflicting', () => {
	it('keeps the amber word even without citations', () => {
		render('viewer', 0, { isConflicting: true });
		const marker = document.querySelector('[data-testid="claim-state"]');
		expect(marker?.getAttribute('data-state')).toBe('conflicting');
		expect(marker?.textContent).toContain('Conflicting');
	});
});
