import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import UploadProgress from './UploadProgress.svelte';

let component: Record<string, unknown> | null = null;
afterEach(() => {
	if (component) unmount(component);
	component = null;
	document.body.innerHTML = '';
});

function render(props: Record<string, unknown>) {
	component = mount(UploadProgress, {
		target: document.body,
		props: {
			fileName: 'scan.pdf',
			uploadedBytes: 0,
			totalBytes: 1000,
			phase: 'uploading',
			oncancel: () => {},
			onretry: () => {},
			...props
		}
	} as never);
	flushSync();
}

const bar = () => document.querySelector<HTMLElement>('[role="progressbar"]')!;

describe('UploadProgress', () => {
	it('exposes the percentage and bytes to assistive technology', () => {
		render({ uploadedBytes: 250, totalBytes: 1000 });
		expect(bar().getAttribute('aria-valuenow')).toBe('25');
		expect(bar().getAttribute('aria-valuetext')).toBe('25%, 250 B of 1000 B');
		expect(document.querySelector('#upload-progress-label')!.textContent).toBe('scan.pdf');
		expect(bar().getAttribute('aria-labelledby')).toBe('upload-progress-label');
		expect(document.querySelector('[data-testid="upload-percent"]')!.textContent).toBe('25%');
	});

	it('never shows more than 100 percent', () => {
		render({ uploadedBytes: 2000, totalBytes: 1000 });
		expect(bar().getAttribute('aria-valuenow')).toBe('100');
	});

	it('offers cancel while uploading', () => {
		const oncancel = vi.fn();
		render({ oncancel });
		document.querySelector<HTMLButtonElement>('button')!.click();
		expect(oncancel).toHaveBeenCalledOnce();
		expect(document.querySelector('[role="alert"]')).toBeNull();
	});

	it('says the file is being added once every byte is sent, with no buttons', () => {
		render({ phase: 'finishing', uploadedBytes: 1000 });
		expect(document.body.textContent).toContain('Adding the file');
		expect(document.querySelector('button')).toBeNull();
	});

	it('announces a failure, offers retry and moves focus to it', () => {
		const onretry = vi.fn();
		render({ phase: 'failed', error: 'Too many uploads', onretry });
		expect(document.querySelector('[role="alert"]')!.textContent).toContain('Too many uploads');
		const retry = document.querySelector<HTMLButtonElement>('button')!;
		expect(retry.textContent!.trim()).toBe('Try again');
		expect(document.activeElement).toBe(retry);
		retry.click();
		expect(onretry).toHaveBeenCalledOnce();
	});
});
