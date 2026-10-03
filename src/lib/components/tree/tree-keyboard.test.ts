import { describe, expect, it, vi } from 'vitest';
import { activateOnKey, isActivationKey } from './activate-on-key';
import { keyIntentOf } from './tree-keyboard';

/** An element stand-in: `closest` answers from a table of selector to attribute value. */
function target(attributes: Record<string, string> = {}, isField = false): Element {
	return {
		closest: (selector: string) => {
			if (isField && selector.includes('input')) return {};
			const attribute = /^\[([\w-]+)\]$/.exec(selector)?.[1];
			if (!attribute || !(attribute in attributes)) return null;
			return { getAttribute: (name: string) => (name === attribute ? attributes[name] : null) };
		}
	} as unknown as Element;
}

const press = (key: string, el: Element, isShift = false) =>
	keyIntentOf({ key, shiftKey: isShift, target: el });

describe('keyIntentOf', () => {
	it('leaves typing in a field alone', () => {
		expect(press('ArrowUp', target({ 'data-person-id': 'p1' }, true))).toEqual({ kind: 'ignore' });
		expect(press('Escape', target({}, true))).toEqual({ kind: 'ignore' });
	});

	it('reads both of the keyboard’s context-menu gestures, with what has focus', () => {
		const el = target({ 'data-person-id': 'p1', 'data-edge-id': 'e1' });
		const expected = {
			kind: 'context-menu',
			target: { personId: 'p1', unionId: null, edgeId: 'e1' }
		};
		expect(press('ContextMenu', el)).toEqual(expected);
		expect(press('F10', el, true)).toEqual(expected);
		expect(press('F10', el)).toEqual({ kind: 'ignore' });
	});

	it('reads Escape and Delete or Backspace', () => {
		const el = target();
		expect(press('Escape', el)).toEqual({ kind: 'escape' });
		expect(press('Delete', el)).toEqual({ kind: 'delete' });
		expect(press('Backspace', el)).toEqual({ kind: 'delete' });
	});

	it.each([
		['ArrowUp', 'up'],
		['ArrowDown', 'down'],
		['ArrowLeft', 'left'],
		['ArrowRight', 'right']
	])('moves %s from the card that has focus', (key, direction) => {
		expect(press(key, target({ 'data-person-id': 'p7' }))).toEqual({
			kind: 'move',
			direction,
			fromId: 'p7'
		});
	});

	it('ignores an arrow when no card has focus, and any other key', () => {
		expect(press('ArrowUp', target())).toEqual({ kind: 'ignore' });
		expect(press('a', target({ 'data-person-id': 'p1' }))).toEqual({ kind: 'ignore' });
	});
});

describe('activateOnKey', () => {
	const keyEvent = (key: string) =>
		({ key, preventDefault: vi.fn() }) as unknown as KeyboardEvent & {
			preventDefault: ReturnType<typeof vi.fn>;
		};

	it.each(['Enter', ' '])('runs the handler for %j and stops the page scrolling', (key) => {
		const run = vi.fn();
		const event = keyEvent(key);
		activateOnKey(run)(event);
		expect(run).toHaveBeenCalledWith(event);
		expect(event.preventDefault).toHaveBeenCalled();
		expect(isActivationKey(event)).toBe(true);
	});

	it('ignores every other key', () => {
		const run = vi.fn();
		const event = keyEvent('a');
		activateOnKey(run)(event);
		expect(run).not.toHaveBeenCalled();
		expect(event.preventDefault).not.toHaveBeenCalled();
	});
});
