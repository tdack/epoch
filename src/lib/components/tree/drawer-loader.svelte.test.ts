import { describe, expect, it, vi } from 'vitest';

vi.mock('#lib/services/tree-api.js', () => ({ fetchPersonPage: vi.fn() }));

import type { PersonPageDto } from '#lib/shared/person-page.js';
import { createDrawerLoader } from './drawer-loader.svelte.js';

const pageOf = (id: string) => ({ id }) as unknown as PersonPageDto;
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (cause: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

describe('createDrawerLoader', () => {
	it('shows the loaded page and clears on null', async () => {
		const loader = createDrawerLoader({
			treeId: () => 't',
			onMissing: vi.fn(),
			fetchPage: async (_tree, id) => pageOf(id)
		});
		loader.load('a');
		await flush();
		expect(loader.page).toEqual(pageOf('a'));
		loader.load(null);
		expect(loader.page).toBeNull();
		expect(loader.error).toBeNull();
	});

	it('does not let a slow earlier response overwrite a later one', async () => {
		const slow = deferred<PersonPageDto>();
		const fast = deferred<PersonPageDto>();
		const pending = new Map([
			['a', slow],
			['b', fast]
		]);
		const loader = createDrawerLoader({
			treeId: () => 't',
			onMissing: vi.fn(),
			fetchPage: (_tree, id) => pending.get(id)!.promise
		});
		loader.load('a');
		loader.load('b');
		fast.resolve(pageOf('b'));
		await flush();
		slow.resolve(pageOf('a'));
		await flush();
		expect(loader.page).toEqual(pageOf('b'));
	});

	it('drops a response that lands after the drawer closed', async () => {
		const slow = deferred<PersonPageDto>();
		const loader = createDrawerLoader({
			treeId: () => 't',
			onMissing: vi.fn(),
			fetchPage: () => slow.promise
		});
		loader.load('a');
		loader.load(null);
		slow.resolve(pageOf('a'));
		await flush();
		expect(loader.page).toBeNull();
	});

	it('calls onMissing and shows the message when the load fails', async () => {
		const onMissing = vi.fn();
		const loader = createDrawerLoader({
			treeId: () => 't',
			onMissing,
			fetchPage: () => Promise.reject(new Error('gone'))
		});
		loader.load('a');
		await flush();
		expect(onMissing).toHaveBeenCalledTimes(1);
		expect(loader.error).toBe('gone');
	});

	it('ignores a failure from a superseded request', async () => {
		const stale = deferred<PersonPageDto>();
		const onMissing = vi.fn();
		const loader = createDrawerLoader({
			treeId: () => 't',
			onMissing,
			fetchPage: (_tree, id) => (id === 'a' ? stale.promise : Promise.resolve(pageOf(id)))
		});
		loader.load('a');
		loader.load('b');
		stale.reject(new Error('late'));
		await flush();
		expect(onMissing).not.toHaveBeenCalled();
		expect(loader.error).toBeNull();
	});
});
