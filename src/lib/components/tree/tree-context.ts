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

/**
 * How the chart page and the header's person finder reach each other. Plain mutable fields, not
 * state: both sides read them at event time, so nothing needs to re-render when they change.
 */
export interface FinderBridge {
	/** Set by the chart page while it is mounted: refocus the chart on a person picked in the header. */
	pickFocus: ((personId: string) => void) | null;
	/** Set by the header: move keyboard focus into the finder's input. */
	focusInput: (() => void) | null;
}

export interface TreeContext {
	toasts: ToastStore;
	editor: TreeEditor;
	marks: MarksStore;
	finder: FinderBridge;
	/**
	 * Nobody is signed in: the reader of the public tree. A screen must not call an endpoint that
	 * stores something for a user, since the answer is a 401 and the API client reacts to a 401 by
	 * sending the browser to sign in.
	 */
	isPublicVisitor: boolean;
}

export function setTreeContext(context: TreeContext): void {
	setContext(KEY, context);
}

export function getTreeContext(): TreeContext {
	const context = getContext<TreeContext | undefined>(KEY);
	if (!context) throw new Error('This screen must be rendered inside a tree layout');
	return context;
}
