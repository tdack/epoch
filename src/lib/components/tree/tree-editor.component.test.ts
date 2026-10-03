import { describe, expect, it, vi } from 'vitest';
import { ToastStore } from '#lib/components/feedback/toasts.svelte.js';
import { TreeEditor } from './tree-editor.svelte.js';

function setup() {
	const toasts = new ToastStore();
	const refresh = vi.fn(async () => {});
	return { toasts, refresh, editor: new TreeEditor({ treeId: () => 't1', toasts, refresh }) };
}

describe('editor.mutate', () => {
	it('reloads, then says what happened, with Undo when the change can be undone', async () => {
		const { editor, toasts, refresh } = setup();
		const change = { id: 'c1', kind: 'update', summary: 'Names reordered', isUndoable: true };
		expect(await editor.mutate(async () => ({ change }), { done: 'Done', failure: 'No' })).toBe(
			true
		);
		expect(refresh).toHaveBeenCalledTimes(1);
		expect(toasts.items).toMatchObject([
			{ message: 'Names reordered', tone: 'success', action: { label: 'Undo' } }
		]);
	});

	it('falls back to its own words when the change has no summary', async () => {
		const { editor, toasts } = setup();
		await editor.mutate(async () => ({ change: null }), { done: 'Privacy changed', failure: 'No' });
		expect(toasts.items.map((t) => t.message)).toEqual(['Privacy changed']);
	});

	it('shows the server’s message as an error and answers false, without reloading', async () => {
		const { editor, toasts, refresh } = setup();
		const ok = await editor.mutate(
			async () => {
				throw new Error('Someone else changed this');
			},
			{ done: 'Done', failure: 'Could not reorder' }
		);
		expect(ok).toBe(false);
		expect(refresh).not.toHaveBeenCalled();
		expect(toasts.items).toMatchObject([{ message: 'Someone else changed this', tone: 'error' }]);
	});

	it('names the failure itself when the error carries no message', async () => {
		const { editor, toasts } = setup();
		await editor.mutate(
			async () => {
				throw new Error('');
			},
			{ done: 'Done', failure: 'Could not reorder' }
		);
		expect(toasts.items.map((t) => t.message)).toEqual(['Could not reorder']);
	});
});
