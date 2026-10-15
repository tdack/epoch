import { describe, expect, it, vi } from 'vitest';

vi.mock('#lib/api/tree-api.js', () => ({
	isConflict: (cause: unknown) => (cause as { isStale?: boolean })?.isStale === true
}));

import { createSubmission } from './submission.svelte.js';

describe('createSubmission', () => {
	it('tracks isSaving around a successful run', async () => {
		const save = createSubmission(vi.fn());
		let wasSavingDuring = false;
		await save.submit(async () => {
			wasSavingDuring = save.isSaving;
		}, 'fallback');
		expect(wasSavingDuring).toBe(true);
		expect(save.isSaving).toBe(false);
		expect(save.error).toBeNull();
	});

	it('shows the message of a failure, or the fallback', async () => {
		const save = createSubmission(vi.fn());
		await save.submit(() => Promise.reject(new Error('nope')), 'fallback');
		expect(save.error).toBe('nope');
		await save.submit(() => Promise.reject('x'), 'fallback');
		expect(save.error).toBe('fallback');
		expect(save.isSaving).toBe(false);
	});

	it('hands a conflict to onstale without showing an error', async () => {
		const onstale = vi.fn();
		const save = createSubmission(onstale);
		await save.submit(
			() => Promise.reject(Object.assign(new Error('stale'), { isStale: true })),
			'f'
		);
		expect(onstale).toHaveBeenCalledWith('stale');
		expect(save.error).toBeNull();
	});

	it('clears a previous error on the next submit and via clearError', async () => {
		const save = createSubmission(vi.fn());
		await save.submit(() => Promise.reject(new Error('nope')), 'f');
		await save.submit(async () => {}, 'f');
		expect(save.error).toBeNull();
		await save.submit(() => Promise.reject(new Error('again')), 'f');
		save.clearError();
		expect(save.error).toBeNull();
	});
});
