import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import type { ChangeEntryDto } from '#lib/shared/person-page.js';
import ChangeList from './ChangeList.svelte';

let component: Record<string, unknown> | null = null;
afterEach(() => {
	if (component) unmount(component);
	component = null;
	document.body.innerHTML = '';
});

const entry = (over: Partial<ChangeEntryDto>): ChangeEntryDto => ({
	id: 'c1',
	kind: 'add_person',
	summary: 'Added Wren',
	actorName: 'Ann',
	createdAt: 0,
	isUndo: false,
	isUndone: false,
	canUndo: true,
	...over
});

function render(changes: ChangeEntryDto[], undoChange = vi.fn()) {
	component = mount(ChangeList, {
		target: document.body,
		props: {
			changes,
			recordId: 'p 1',
			tree: { id: 't1', slug: null },
			editor: { undoChange },
			emptyText: 'Nothing logged.'
		}
	});
	flushSync();
	return undoChange;
}

describe('ChangeList', () => {
	it('undoes the change its button names', () => {
		const undo = render([entry({ id: 'a' }), entry({ id: 'b', summary: 'Edited Wren' })]);
		document.querySelector<HTMLButtonElement>('button[aria-label="Undo: Edited Wren"]')!.click();
		expect(undo).toHaveBeenCalledWith('b');
	});

	it('offers no button for a change the viewer cannot undo, and says when it was undone', () => {
		render([entry({ canUndo: false, isUndone: true })]);
		expect(document.querySelector('button')).toBeNull();
		expect(document.body.textContent).toContain('undone');
	});

	it('links to the audit log filtered to the record', () => {
		render([entry({})]);
		expect(document.querySelector('a')!.getAttribute('href')).toBe('/trees/t1/audit?record=p%201');
	});

	it('shows the empty text and no link when nothing is logged', () => {
		render([]);
		expect(document.body.textContent).toContain('Nothing logged.');
		expect(document.querySelector('a')).toBeNull();
	});
});
