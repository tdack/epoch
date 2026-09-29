import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';

vi.mock('#lib/services/tree-api.js', () => ({
	searchPeopleApi: vi.fn(),
	planRelationshipApi: vi.fn(),
	applyRelationshipApi: vi.fn(),
	isConflict: () => false
}));

import { planRelationshipApi } from '#lib/services/tree-api.js';
import RelationshipModal from './RelationshipModal.svelte';

const plan = vi.mocked(planRelationshipApi);

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
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
	vi.useRealTimers();
	if (component) unmount(component);
	component = null;
	document.body.innerHTML = '';
	plan.mockReset();
});

const person = (id: string, displayName: string) => ({ id, displayName, sex: 'U' as const, isDeceased: false, parentsByUnion: {}, unionIds: [], stepParents: [] });
const union = (id: string, partnerIds: string[], childIds: string[] = []) => ({
	id,
	status: 'active' as const,
	marriageDate: null,
	marriagePlace: null,
	partnerIds,
	version: 1,
	events: [],
	children: childIds.map((childId) => ({ childId, parentId: partnerIds[0], type: 'biological' as const }))
});

const people = ['homer', 'marge', 'lisa', 'sam'].map((id) => person(id, id[0].toUpperCase() + id.slice(1)));
const graphOf = (unions: ReturnType<typeof union>[]) => ({ people, unions, parentChild: [] });

async function open(graph: ReturnType<typeof graphOf>, initialKind: 'add_child' | 'add_partner') {
	plan.mockResolvedValue({
		sentence: 'Sam will be recorded as …',
		commands: [{}],
		warnings: [],
		unionChoice: { unionId: 'u1', isDefault: true, reason: 'Chosen because it has the most children recorded (1). Pick another if that is not the family you mean.' }
	});
	component = mount(RelationshipModal, {
		target: document.body,
		props: {
			show: true,
			treeId: 't',
			anchor: { id: 'homer', givenName: 'Homer', surname: null },
			graph,
			preselect: { id: 'sam', givenName: 'Sam', surname: null },
			initialKind,
			onclose: vi.fn(),
			onsaved: vi.fn(),
			onrefresh: vi.fn()
		}
	});
	flushSync();
	await vi.advanceTimersByTimeAsync(300);
	flushSync();
}

const radios = () => [...document.querySelectorAll<HTMLInputElement>('input[name="rel-union"]')];

describe('RelationshipModal partnership chooser', () => {
	it('lists every partnership when there are several, preselects the server default and says why', async () => {
		await open(graphOf([union('u1', ['homer', 'marge'], ['lisa']), union('u2', ['homer', 'marge'])]), 'add_child');
		expect(document.querySelector('fieldset legend')!.textContent).toBe('Which partnership');
		expect(radios().map((r) => r.dataset.unionId)).toEqual(['u1', 'u2']);
		expect(radios().map((r) => r.checked)).toEqual([true, false]);
		expect(document.querySelector('[data-testid="union-reason"]')!.textContent).toContain('most children');
		expect(document.querySelector('fieldset')!.textContent).toContain('1st partnership');
	});

	it('sends the picked partnership with the next preview and stops showing the default reason', async () => {
		await open(graphOf([union('u1', ['homer', 'marge'], ['lisa']), union('u2', ['homer', 'marge'])]), 'add_child');
		radios()[1].click();
		radios()[1].dispatchEvent(new Event('change', { bubbles: true }));
		flushSync();
		await vi.advanceTimersByTimeAsync(300);
		expect(plan.mock.calls.at(-1)![1]).toMatchObject({ kind: 'add_child', unionId: 'u2' });
		expect(document.querySelector('[data-testid="union-reason"]')).toBeNull();
	});

	it('shows no chooser when there is one partnership, and sends no partnership', async () => {
		await open(graphOf([union('u1', ['homer', 'marge'])]), 'add_child');
		expect(document.querySelector('[data-testid="union-chooser"]')).toBeNull();
		expect(plan.mock.calls.at(-1)![1]).not.toHaveProperty('unionId', expect.any(String));
	});

	it('offers a new partnership beside the ones waiting for a partner when adding a partner', async () => {
		await open(graphOf([union('u1', ['homer']), union('u2', ['homer'])]), 'add_partner');
		expect(radios().map((r) => r.dataset.unionId)).toEqual(['u1', 'u2', 'new']);
		expect(document.querySelector('fieldset legend')!.textContent).toBe('Which partnership to fill');
	});
});
