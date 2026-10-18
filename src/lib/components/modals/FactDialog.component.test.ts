import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';

vi.mock('#lib/api/client.js', () => ({
	isConflict: vi.fn(() => false)
}));

vi.mock('#lib/api/lists.js', () => ({
	suggestPlacesApi: vi.fn()
}));

vi.mock('#lib/api/evidence.js', () => ({
	fetchSources: vi.fn(async () => ({
		items: [{ id: 's1', title: 'Parish register', author: null }]
	})),
	createSourceApi: vi.fn()
}));

vi.mock('#lib/api/people.js', () => ({
	createFactApi: vi.fn(),
	previewFactApi: vi.fn(),
	updateFactApi: vi.fn()
}));

import { suggestPlacesApi } from '#lib/api/lists.js';
import { createFactApi, previewFactApi, updateFactApi } from '#lib/api/people.js';
import type { TreeRole } from '#lib/shared/roles.js';
import type { FactDto } from '#lib/shared/person-page.js';
import FactDialog from './FactDialog.svelte';

beforeAll(() => {
	// jsdom has no modal dialog support; opening is all these tests need from it.
	HTMLDialogElement.prototype.showModal = function () {
		this.setAttribute('open', '');
	};
	HTMLDialogElement.prototype.close = function () {
		this.removeAttribute('open');
	};
});

let component: Record<string, unknown> | null = null;
afterEach(() => {
	if (component) unmount(component);
	component = null;
	document.body.innerHTML = '';
	vi.clearAllMocks();
});

/** A baptism as the importer leaves it: the details the editor does not show yet, all filled in. */
const IMPORTED = {
	id: 'f1',
	type: 'BAPM',
	label: 'Baptism',
	kind: 'event',
	dateText: '1900',
	sortStart: '1900-01-01',
	isApproximate: false,
	place: 'York',
	value: null,
	cause: null,
	age: null,
	address: '  12 High St\nYork  ',
	classification: 'Adult',
	agency: 'Parish of St Mary, Leeds',
	phone: '0113 000\n0113 111',
	email: 'parish@example.test',
	fax: null,
	web: 'https://example.test',
	latitude: 'N53.8',
	longitude: 'W1.5',
	religion: 'Anglican',
	retainedLines: ['2 RESN locked'],
	notes: null,
	isLegacyNote: false,
	sortOrder: 0,
	version: 3,
	conflict: null,
	citationCount: 0,
	noteItems: []
} as unknown as FactDto;

/** What the dialog sends: the stored details, trimmed (the server keeps stored text when equal). */
const DETAIL_FIELDS = {
	address: '12 High St\nYork',
	classification: 'Adult',
	agency: 'Parish of St Mary, Leeds',
	phone: '0113 000\n0113 111',
	email: 'parish@example.test',
	fax: null,
	web: 'https://example.test',
	latitude: 'N53.8',
	longitude: 'W1.5',
	religion: 'Anglican'
};

function render(fact: FactDto | null, role: TreeRole | undefined = 'editor') {
	vi.mocked(previewFactApi).mockResolvedValue({
		headline: '',
		records: [],
		moves: [],
		people: [],
		isDestructive: false
	} as never);
	vi.mocked(suggestPlacesApi).mockResolvedValue([]);
	vi.mocked(updateFactApi).mockResolvedValue({ change: null });
	vi.mocked(createFactApi).mockResolvedValue({ change: null } as never);
	component = mount(FactDialog, {
		target: document.body,
		props: {
			isOpen: true,
			treeId: 't1',
			personId: 'p1',
			fact,
			role,
			onsaved: vi.fn(),
			onstale: vi.fn(),
			oncancel: vi.fn()
		}
	});
	flushSync();
}

function save() {
	document
		.querySelector<HTMLFormElement>('[data-testid="fact-form"]')!
		.dispatchEvent(new Event('submit', { cancelable: true }));
	flushSync();
}

function choose(code: string) {
	const select = document.getElementById('fact-type');
	if (!(select instanceof HTMLSelectElement)) throw new Error('no fact type select');
	select.value = code;
	select.dispatchEvent(new Event('change', { bubbles: true }));
	flushSync();
}

const detailsOf = () => document.querySelector<HTMLDetailsElement>('[data-testid="fact-details"]')!;

function cleanup() {
	if (component) unmount(component);
	component = null;
	document.body.innerHTML = '';
}

describe('FactDialog', () => {
	it('sends an imported fact back with its details when only the date is edited', async () => {
		render(IMPORTED);
		const date = document.querySelector<HTMLInputElement>('#fact-date')!;
		date.value = '1 JAN 1900';
		date.dispatchEvent(new Event('input', { bubbles: true }));
		flushSync();
		save();

		await vi.waitFor(() => expect(updateFactApi).toHaveBeenCalledTimes(1));
		expect(updateFactApi).toHaveBeenCalledWith(
			't1',
			'f1',
			expect.objectContaining({ dateText: '1 JAN 1900', ...DETAIL_FIELDS }),
			3,
			null
		);
	});

	it('opens the Details section for a fact that has details, and not for a new one', () => {
		render(IMPORTED);
		expect(detailsOf().open).toBe(true);
		cleanup();
		render(null);
		expect(detailsOf().open).toBe(false);
	});

	it('edits each detail field and sends it trimmed', async () => {
		render(null);
		const setText = (id: string, text: string) => {
			const el = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(`#${id}`)!;
			el.value = text;
			el.dispatchEvent(new Event('input', { bubbles: true }));
			flushSync();
		};
		choose('BAPM');
		setText('fact-place', 'York');
		setText('fact-address', '  12 High St\nYork  ');
		setText('fact-classification', ' At home ');
		setText('fact-agency', ' Parish of St Mary ');
		setText('fact-religion', ' Anglican ');
		setText('fact-phone', ' 0113 000\n0113 111 ');
		setText('fact-email', ' parish@example.test ');
		setText('fact-fax', '  ');
		setText('fact-web', ' https://example.test ');
		setText('fact-latitude', ' N53.8 ');
		setText('fact-longitude', ' W1.5 ');
		save();

		await vi.waitFor(() => expect(createFactApi).toHaveBeenCalledTimes(1));
		expect(vi.mocked(createFactApi).mock.calls[0]![2]).toMatchObject({
			type: 'BAPM',
			address: '12 High St\nYork',
			classification: 'At home',
			agency: 'Parish of St Mary',
			religion: 'Anglican',
			phone: '0113 000\n0113 111',
			email: 'parish@example.test',
			fax: null,
			web: 'https://example.test',
			latitude: 'N53.8',
			longitude: 'W1.5'
		});
	});

	it('places the sub-type under Type for an event, and inside Details for another fact', () => {
		render(null);
		choose('EVEN');
		expect(detailsOf().contains(document.querySelector('#fact-classification'))).toBe(false);
		choose('OCCU');
		expect(detailsOf().contains(document.querySelector('#fact-classification'))).toBe(true);
	});

	it('hides the religion field for a religion fact', () => {
		render(null);
		expect(document.querySelector('#fact-religion')).not.toBeNull();
		choose('RELI');
		expect(document.querySelector('#fact-religion')).toBeNull();
	});

	it('disables the coordinates until the fact has a place', () => {
		render(null);
		expect(document.querySelector<HTMLInputElement>('#fact-latitude')!.disabled).toBe(true);
		const place = document.querySelector<HTMLInputElement>('#fact-place')!;
		place.value = 'York';
		place.dispatchEvent(new Event('input', { bubbles: true }));
		flushSync();
		expect(document.querySelector<HTMLInputElement>('#fact-latitude')!.disabled).toBe(false);
	});

	it('sends no details for a new fact', async () => {
		render(null);
		save();

		await vi.waitFor(() => expect(createFactApi).toHaveBeenCalledTimes(1));
		const [, , input] = vi.mocked(createFactApi).mock.calls[0]!;
		expect(input).toMatchObject({
			address: null,
			agency: null,
			phone: null,
			latitude: null,
			religion: null
		});
	});

	it('offers a collapsed Source section that cites nothing while closed or empty', async () => {
		render(null);
		const section = document.querySelector<HTMLDetailsElement>(
			'details:has(#fact-source-source-search)'
		);
		expect(section).not.toBeNull();
		expect(section!.open).toBe(false);
		expect(section!.querySelector('summary')!.textContent).toBe('Source (optional)');
		save();
		await Promise.resolve();
		expect(createFactApi).toHaveBeenCalledWith('t1', 'p1', expect.anything(), null);
	});

	it('hides the Source section from a role that cannot cite', () => {
		render(null, 'viewer');
		expect(document.querySelector('#fact-source-source-search')).toBeNull();
		expect(document.body.textContent).not.toContain('Source (optional)');
	});
});
