import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';

vi.mock('#lib/api/lists.js', () => ({ suggestPlacesApi: vi.fn() }));
vi.mock('#lib/api/relationships.js', () => ({ updateUnionApi: vi.fn() }));

import UnionEditorModal from './UnionEditorModal.svelte';

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
});

describe('UnionEditorModal', () => {
	it('offers place suggestions on every event row', () => {
		component = mount(UnionEditorModal, {
			target: document.body,
			props: {
				isOpen: true,
				treeId: 't',
				union: {
					id: 'u1',
					status: 'active',
					marriageDate: null,
					marriagePlace: null,
					partnerIds: ['a', 'b'],
					version: 1,
					children: [],
					events: [
						{ id: 'e1', type: 'MARR', dateText: '1990', place: 'Leeds' },
						{ id: 'e2', type: 'DIV', dateText: null, place: null }
					]
				},
				nameOf: (id: string) => id,
				onclose: () => {},
				onsaved: () => {},
				onrefresh: async () => {}
			}
		});
		flushSync();
		const fields = document.querySelectorAll<HTMLInputElement>('input[id^="ev-place-"]');
		expect(fields).toHaveLength(2);
		for (const field of fields) expect(field.list).toBeInstanceOf(HTMLDataListElement);
	});
});
