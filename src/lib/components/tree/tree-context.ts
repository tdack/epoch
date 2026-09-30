/**
 * What the screens under a tree share: one toast store, one editor and the user's marks. The layout creates them and
 * a screen reads them here, because a toast after "delete this person" has to outlive the screen
 * that was about them, and the dialogs are rendered once for all of them. Leaf components never
 * read this; screens hand them what they need as props.
 */

import { getContext, setContext } from 'svelte';
import type { ToastStore } from '#lib/components/feedback/toasts.svelte.js';
import type { MarksStore } from '#lib/components/layout/marks-store.svelte.js';
import type { TreeEditor } from './tree-editor.svelte.js';

const KEY = Symbol('epoch-tree-context');

export interface TreeContext {
	toasts: ToastStore;
	editor: TreeEditor;
	marks: MarksStore;
}

export function setTreeContext(context: TreeContext): void {
	setContext(KEY, context);
}

export function getTreeContext(): TreeContext {
	const context = getContext<TreeContext | undefined>(KEY);
	if (!context) throw new Error('This screen must be rendered inside a tree layout');
	return context;
}
