/**
 * What a key press on the tree canvas means, decided from the key and the element it landed on. The
 * canvas does the acting (opening menus, moving the cursor); this only reads, so it can be tested
 * without a canvas.
 */

import { NAV_DIRECTIONS, type NavDirection } from './tree-view.js';

const ARROW_KEYS: Record<string, NavDirection> = {
	ArrowUp: NAV_DIRECTIONS.UP,
	ArrowDown: NAV_DIRECTIONS.DOWN,
	ArrowLeft: NAV_DIRECTIONS.LEFT,
	ArrowRight: NAV_DIRECTIONS.RIGHT
};

/** The ids a focused element stands for: the nearest card, partnership and line around it. */
interface KeyTarget {
	personId: string | null;
	unionId: string | null;
	edgeId: string | null;
}

function keyTargetOf(target: Element): KeyTarget {
	const idOf = (attribute: string) =>
		target.closest?.(`[${attribute}]`)?.getAttribute(attribute) ?? null;
	return {
		personId: idOf('data-person-id'),
		unionId: idOf('data-union-id'),
		edgeId: idOf('data-edge-id')
	};
}

export type KeyIntent =
	| { kind: 'ignore' }
	/** The keyboard's context-menu gesture: open the menu of whatever has focus. */
	| { kind: 'context-menu'; target: KeyTarget }
	| { kind: 'escape' }
	| { kind: 'delete' }
	| { kind: 'move'; direction: NavDirection; fromId: string };

export function keyIntentOf(
	event: Pick<KeyboardEvent, 'key' | 'shiftKey'> & { target: Element }
): KeyIntent {
	if (event.target.closest?.('input, textarea, select')) return { kind: 'ignore' };
	if (event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey)) {
		return { kind: 'context-menu', target: keyTargetOf(event.target) };
	}
	if (event.key === 'Escape') return { kind: 'escape' };
	if (event.key === 'Delete' || event.key === 'Backspace') return { kind: 'delete' };
	const direction = ARROW_KEYS[event.key];
	const fromId = keyTargetOf(event.target).personId;
	if (direction && fromId) return { kind: 'move', direction, fromId };
	return { kind: 'ignore' };
}
