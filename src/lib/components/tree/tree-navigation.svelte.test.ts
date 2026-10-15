import { describe, expect, it, vi } from 'vitest';
import { createTreeNavigation } from './tree-navigation.svelte.js';
import { HISTORY_KINDS } from './tree-url.js';

/** A `go` whose promises the test resolves by hand, in call order. */
function manualGo() {
	const resolvers: Array<() => void> = [];
	const go = vi.fn(
		(_href: string, _isReplace: boolean) => new Promise<void>((resolve) => resolvers.push(resolve))
	);
	return { go, finish: (index = 0) => resolvers[index]() };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('createTreeNavigation', () => {
	it('calls go once and clears pendingSearch after it settles', async () => {
		const { go, finish } = manualGo();
		const nav = createTreeNavigation(go);
		nav.push({ query: 'focus=a', kind: HISTORY_KINDS.FOCUS });
		expect(go).toHaveBeenCalledTimes(1);
		expect(go).toHaveBeenCalledWith('?focus=a', false);
		expect(nav.pendingSearch).toBe('?focus=a');
		finish();
		await flush();
		expect(nav.pendingSearch).toBeNull();
	});

	it('passes an empty href for the bare path', () => {
		const { go } = manualGo();
		const nav = createTreeNavigation(go);
		nav.push({ query: '' });
		expect(go).toHaveBeenCalledWith('', false);
		expect(nav.pendingSearch).toBe('');
	});

	it('queues a push made mid-navigation, keeping only the last', async () => {
		const { go, finish } = manualGo();
		const nav = createTreeNavigation(go);
		nav.push({ query: 'a=1' });
		nav.push({ query: 'a=2' });
		nav.push({ query: 'a=3' });
		expect(go).toHaveBeenCalledTimes(1);
		expect(nav.pendingSearch).toBe('?a=3');
		finish(0);
		await flush();
		expect(go).toHaveBeenCalledTimes(2);
		expect(go).toHaveBeenLastCalledWith('?a=3', false);
		expect(nav.pendingSearch).toBe('?a=3');
		finish(1);
		await flush();
		expect(nav.pendingSearch).toBeNull();
	});

	it('pushes a new entry for focus while repeated adjustments replace', async () => {
		const { go, finish } = manualGo();
		const nav = createTreeNavigation(go);
		nav.push({ query: 'focus=a', kind: HISTORY_KINDS.FOCUS });
		finish(0);
		await flush();
		nav.push({ query: 'depth=1', kind: HISTORY_KINDS.ADJUST });
		finish(1);
		await flush();
		nav.push({ query: 'depth=2', kind: HISTORY_KINDS.ADJUST });
		finish(2);
		await flush();
		expect(go.mock.calls.map((call) => call[1])).toEqual([false, false, true]);
	});

	it('lets an explicit isReplace win over the coalescer', () => {
		const { go } = manualGo();
		const nav = createTreeNavigation(go);
		nav.push({ query: 'x=1', kind: HISTORY_KINDS.FOCUS, isReplace: true });
		expect(go).toHaveBeenCalledWith('?x=1', true);
	});
});
