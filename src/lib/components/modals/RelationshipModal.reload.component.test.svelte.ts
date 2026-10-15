import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';

vi.mock('#lib/api/tree-api.js', () => ({
	searchPeopleApi: vi.fn(),
	planRelationshipApi: vi.fn().mockResolvedValue({
		sentence: 'x will be recorded as y',
		commands: [{}],
		warnings: [],
		unionChoice: null
	}),
	applyRelationshipApi: vi.fn(),
	isConflict: () => false
}));

import RelationshipModal from './RelationshipModal.svelte';

beforeAll(() => {
	HTMLDialogElement.prototype.showModal = function () {
		this.setAttribute('open', '');
	};
	HTMLDialogElement.prototype.close = function () {
		this.removeAttribute('open');
	};
});
beforeEach(() => vi.useFakeTimers());

let component: Record<string, unknown> | null = null;
afterEach(() => {
	vi.useRealTimers();
	if (component) unmount(component);
	component = null;
	document.body.innerHTML = '';
});

const person = (id: string) => ({
	id,
	displayName: id,
	sex: 'U' as const,
	isDeceased: false,
	parentsByUnion: {},
	unionIds: [],
	stepParents: [],
	version: 1
});

it('keeps what the person has typed when the graph reloads behind the open dialog', async () => {
	// The graph reloads after every save, and can land while the next dialog is already open.
	const props = $state({
		isOpen: true,
		treeId: 't',
		anchor: { id: 'a', givenName: 'A', surname: null },
		graph: { people: [person('a')], unions: [], parentChild: [] },
		onclose: () => {},
		onsaved: () => {},
		onrefresh: async () => {}
	});
	component = mount(RelationshipModal, { target: document.body, props });
	flushSync();

	const buttons = () => [...document.querySelectorAll('button')];
	buttons()
		.find((b) => b.textContent?.trim() === 'New person')!
		.click();
	flushSync();
	const given = document.querySelector('#new-given') as unknown as {
		value: string;
		dispatchEvent(e: Event): boolean;
	};
	given.value = 'Wren';
	given.dispatchEvent(new Event('input', { bubbles: true }));
	flushSync();

	props.graph = { people: [person('a'), person('b')], unions: [], parentChild: [] };
	flushSync();
	await vi.advanceTimersByTimeAsync(300);

	expect((document.querySelector('#new-given') as unknown as { value: string }).value).toBe('Wren');
});
