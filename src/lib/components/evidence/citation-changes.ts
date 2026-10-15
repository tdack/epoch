import type { ToastStore } from '#lib/components/feedback/toasts.svelte.js';
import type { TreeEditor } from '#lib/components/tree/tree-editor.svelte.js';

/**
 * What the citation dialog does after a save or a stale refusal. Shared by every place that opens it,
 * so an add from the Unsourced marker and an edit from the list behave the same way.
 */
export function citationSaved(
	editor: TreeEditor,
	change: Parameters<TreeEditor['afterChange']>[0]
): Promise<void> {
	return editor.afterChange(change, 'Citation saved');
}

/** The citation changed under the dialog: reload the record, then say what happened. */
export async function citationStale(
	editor: TreeEditor,
	toasts: ToastStore,
	message: string
): Promise<void> {
	await editor.refresh();
	toasts.push(`${message} Review the citation and try again.`, {
		tone: 'error',
		durationMs: 10_000
	});
}
