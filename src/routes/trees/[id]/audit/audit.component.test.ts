import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';

const undoChange = vi.hoisted(() => vi.fn());
vi.mock('#lib/components/tree/tree-context.js', () => ({
	getTreeContext: () => ({ editor: { undoChange } })
}));

import Page from './+page.svelte';

let component: Record<string, unknown> | null = null;
afterEach(() => {
	if (component) unmount(component);
	component = null;
	document.body.innerHTML = '';
	undoChange.mockReset();
});

const base = {
	seq: 3,
	kind: 'edit_person',
	actorName: 'Ann',
	createdAt: 0,
	isUndo: false,
	isUndone: false,
	undoneByName: null,
	undoneAt: null,
	canUndo: true
};

function render(over: Record<string, unknown> = {}) {
	const data = {
		summary: { tree: { id: 't1', slug: null, name: 'Tree' } },
		filters: { recordId: null, actorId: null, from: null, to: null, tz: null },
		audit: {
			page: 2,
			pageCount: 5,
			total: 110,
			timeZone: 'UTC',
			record: null,
			actors: [
				{ id: 'u1', name: 'Ann' },
				{ id: 'u2', name: 'Bo' }
			],
			entries: [
				{
					...base,
					id: 'c3',
					summary: 'Edited Wren',
					records: [
						{
							entityType: 'person',
							entityId: 'p1',
							label: 'Wren Ash',
							action: 'updated',
							isLinkable: true,
							fields: [{ field: 'surname', before: 'Ash', after: 'Birch' }]
						},
						{
							entityType: 'person',
							entityId: 'gone',
							label: 'Removed Rex',
							action: 'deleted',
							isLinkable: false,
							fields: []
						}
					]
				},
				{
					...base,
					id: 'c2',
					seq: 2,
					summary: 'Added Wren',
					isUndone: true,
					canUndo: false,
					undoneByName: 'Bo',
					undoneAt: 0,
					records: []
				}
			]
		},
		...over
	};
	component = mount(Page, { target: document.body, props: { data } as never });
	flushSync();
}

describe('audit page', () => {
	it('lists entries with a before/after disclosure and links only records that still exist', () => {
		render();
		const first = document.querySelector('[data-testid="audit-entry"]')!;
		expect(first.querySelector('details')!.textContent).toContain('Ash');
		expect(first.querySelector('details')!.textContent).toContain('Birch');
		const links = [...first.querySelectorAll('details a')];
		expect(links.map((a) => a.getAttribute('href'))).toEqual(['/trees/t1/people/p1']);
	});

	it('undoes the entry whose button is pressed, and shows who undid an undone one', () => {
		render();
		document.querySelector<HTMLButtonElement>('button[aria-label="Undo: Edited Wren"]')!.click();
		expect(undoChange).toHaveBeenCalledWith('c3');
		expect(document.querySelectorAll('button[aria-label^="Undo"]')).toHaveLength(1);
		expect(document.querySelector('[data-testid="audit-undone"]')!.textContent).toContain('Bo');
	});

	it('pages with numbered links that keep the filters, and offers to clear them', () => {
		render({
			filters: {
				recordId: 'p1',
				actorId: 'u2',
				from: '2026-01-02',
				to: null,
				tz: 'Australia/Adelaide'
			}
		});
		const hrefs = [...document.querySelectorAll('[data-testid="audit-pager"] a')].map((a) =>
			a.getAttribute('href')
		);
		expect(hrefs).toContain(
			'/trees/t1/audit?record=p1&actor=u2&from=2026-01-02&tz=Australia%2FAdelaide'
		);
		expect(hrefs).toContain(
			'/trees/t1/audit?record=p1&actor=u2&from=2026-01-02&tz=Australia%2FAdelaide&page=5'
		);
		expect(document.querySelector('[aria-current="page"]')!.textContent).toBe('2');
		expect(document.body.textContent).toContain('Showing 26 to 27 of 110');
		expect(document.querySelector('[data-testid="audit-filter"]')!.textContent).toContain('Bo');
		expect(document.querySelector('[data-testid="audit-clear"]')!.getAttribute('href')).toBe(
			'/trees/t1/audit'
		);
	});

	it('offers the actors and the dates as a form that resets the page', () => {
		render();
		const form = document.querySelector<HTMLFormElement>('[data-testid="audit-filters"]')!;
		expect(form.method).toBe('get');
		expect([...form.querySelectorAll('option')].map((o) => o.textContent)).toEqual([
			'Anyone',
			'Ann',
			'Bo'
		]);
		expect(form.querySelector('input[name="page"]')).toBeNull();
		expect(form.querySelectorAll('input[type="date"]')).toHaveLength(2);
	});

	it("names the reader's own zone before anything is filtered", () => {
		render();
		flushSync();
		const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
		expect(document.querySelector('[data-testid="audit-filters"]')!.textContent).toContain(
			`Days are in ${zone} time`
		);
		expect(document.querySelector<HTMLInputElement>('input[name="tz"]')!.value).toBe(zone);
	});

	it('names the person the log is filtered to, and keeps them in the form', () => {
		render({
			filters: { recordId: 'p1', actorId: null, from: null, to: null, tz: null },
			audit: {
				entries: [],
				page: 1,
				pageCount: 1,
				total: 0,
				timeZone: 'UTC',
				actors: [],
				record: { id: 'p1', kind: 'person', name: 'Wren Ash' }
			}
		});
		expect(document.querySelector('[data-testid="audit-filter"]')!.textContent).toContain(
			'changes to Wren Ash'
		);
		expect(document.querySelector<HTMLInputElement>('input[role="combobox"]')!.placeholder).toBe(
			'Wren Ash'
		);
		expect(document.querySelector<HTMLInputElement>('input[name="record"]')!.value).toBe('p1');
	});

	it('tells an empty filtered list from an empty log', () => {
		render({
			audit: {
				entries: [],
				page: 1,
				pageCount: 1,
				total: 0,
				timeZone: 'UTC',
				actors: [],
				record: null
			},
			filters: { recordId: null, actorId: null, from: '2026-01-01', to: null, tz: null }
		});
		expect(document.querySelector('[data-testid="audit-empty"]')!.textContent).toContain(
			'No changes match these filters'
		);
		expect(document.querySelector('[data-testid="audit-pager"]')).toBeNull();
	});

	it('says so when the log is empty', () => {
		render({
			audit: {
				entries: [],
				page: 1,
				pageCount: 1,
				total: 0,
				timeZone: 'UTC',
				actors: [],
				record: null
			}
		});
		expect(document.body.textContent).toContain('No changes are logged');
	});
});
