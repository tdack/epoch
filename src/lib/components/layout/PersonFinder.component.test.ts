import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import PersonFinder from './PersonFinder.svelte';

let component: Record<string, unknown> | null = null;
afterEach(() => {
	if (component) unmount(component);
	component = null;
	document.body.innerHTML = '';
	vi.useRealTimers();
});

const suggestions = {
	favorites: [{ id: 'p 1', displayName: 'Ann Lee' }],
	recents: []
};

function render(props: Record<string, unknown> = {}) {
	const onnavigate = vi.fn();
	const onpickFocus = vi.fn();
	component = mount(PersonFinder, {
		target: document.body,
		props: {
			treeId: 't1',
			searchPeople: vi.fn().mockResolvedValue([{ id: 'p2', givenName: 'Bede', surname: 'Cole' }]),
			suggestions,
			onnavigate,
			onpickFocus,
			...props
		}
	});
	flushSync();
	return { onnavigate, onpickFocus, input: document.querySelector('input')! };
}

function press(target: EventTarget, key: string, init: KeyboardEventInit = {}) {
	target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...init }));
	flushSync();
}

describe('PersonFinder', () => {
	it('offers favourites before anything is typed and refocuses the chart on Enter', () => {
		const { input, onpickFocus, onnavigate } = render();
		input.focus();
		flushSync();
		expect(document.querySelector('[role="option"]')?.textContent).toContain('Favourite');
		press(input, 'Enter');
		expect(onpickFocus).toHaveBeenCalledWith('p 1');
		expect(onnavigate).not.toHaveBeenCalled();
	});

	it('opens the profile on Shift+Enter even on the chart page', () => {
		const { input, onpickFocus, onnavigate } = render();
		input.focus();
		flushSync();
		press(input, 'Enter', { shiftKey: true });
		expect(onnavigate).toHaveBeenCalledWith('/trees/t1/people/p%201');
		expect(onpickFocus).not.toHaveBeenCalled();
	});

	it('opens the profile on Enter where there is no chart to refocus', () => {
		const { input, onnavigate } = render({ onpickFocus: undefined });
		input.focus();
		flushSync();
		press(input, 'Enter');
		expect(onnavigate).toHaveBeenCalledWith('/trees/t1/people/p%201');
	});

	it('ends the results with a fact search for what was typed', async () => {
		vi.useFakeTimers();
		const { input, onnavigate } = render();
		input.value = 'bede 1900';
		input.dispatchEvent(new Event('input', { bubbles: true }));
		await vi.advanceTimersByTimeAsync(250);
		flushSync();
		const options = [...document.querySelectorAll('[role="option"]')];
		expect(options.map((o) => o.textContent?.trim())).toEqual([
			'Bede Cole',
			expect.stringContaining('Search facts, dates and places for “bede 1900”')
		]);
		press(input, 'ArrowDown');
		press(input, 'Enter');
		expect(onnavigate).toHaveBeenCalledWith('/trees/t1/search?q=bede%201900');
	});

	it('takes focus on "/" unless a field is being typed in', () => {
		const { input } = render();
		const other = document.createElement('input');
		document.body.appendChild(other);
		other.focus();
		press(other, '/');
		expect(document.activeElement === other).toBe(true);
		other.blur();
		press(document.body, '/');
		expect(document.activeElement === input).toBe(true);
	});

	it('takes focus on Ctrl+K from anywhere', () => {
		const { input } = render();
		const other = document.createElement('input');
		document.body.appendChild(other);
		other.focus();
		press(other, 'k', { ctrlKey: true });
		expect(document.activeElement === input).toBe(true);
	});
});
