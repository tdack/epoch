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
		recordId: null,
		audit: {
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
			],
			nextBefore: 2
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
		expect(document.querySelectorAll('button')).toHaveLength(1);
		expect(document.querySelector('[data-testid="audit-undone"]')!.textContent).toContain('Bo');
	});

	it('pages with Show older, keeping the record filter, and offers to clear it', () => {
		render({ recordId: 'p1' });
		expect(document.querySelector('[data-testid="audit-older"]')!.getAttribute('href')).toBe(
			'/trees/t1/audit?before=2&record=p1'
		);
		expect(document.querySelector('[data-testid="audit-filter"] a')!.getAttribute('href')).toBe(
			'/trees/t1/audit'
		);
	});

	it('says so when there is nothing to show', () => {
		render({ audit: { entries: [], nextBefore: null } });
		expect(document.body.textContent).toContain('No changes are logged');
		expect(document.querySelector('[data-testid="audit-older"]')).toBeNull();
	});
});
