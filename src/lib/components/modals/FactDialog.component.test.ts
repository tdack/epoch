import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';

vi.mock('#lib/services/tree-api.js', () => ({
	createFactApi: vi.fn(),
	isConflict: vi.fn(() => false),
	previewFactApi: vi.fn(),
	suggestPlacesApi: vi.fn(),
	updateFactApi: vi.fn()
}));

import {
	createFactApi,
	previewFactApi,
	suggestPlacesApi,
	updateFactApi
} from '#lib/services/tree-api.js';
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

const DETAIL_FIELDS = {
	address: '  12 High St\nYork  ',
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

function render(fact: FactDto | null) {
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
			3
		);
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
});
