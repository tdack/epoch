import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastStore } from '#lib/components/feedback/toasts.svelte.js';
import { clearExportClientUuid, exportStatusApi, startGedcomExport } from '#lib/api/files.js';
import { isExpiredExportError } from '#lib/api/client.js';
import { TreeShell } from './tree-shell.svelte.js';

vi.mock('#lib/api/client.js', () => ({
	isExpiredExportError: vi.fn()
}));

vi.mock('#lib/api/files.js', () => ({
	previewGedcomImport: vi.fn(),
	submitGedcomImport: vi.fn(),
	startGedcomExport: vi.fn(),
	exportStatusApi: vi.fn(),
	clearExportClientUuid: vi.fn(),
	exportDownloadUrl: (instanceId: string) => `/api/export/download/${instanceId}`,
	gedcomExportUrl: (treeId: string, choice: { format: string; shouldCompress: boolean }) =>
		`/api/export?treeId=${treeId}&format=${choice.format}${
			choice.shouldCompress ? '&package=gdz' : ''
		}`
}));

vi.mock('#lib/api/trees.js', () => ({
	createTreeApi: vi.fn(),
	deleteTreeApi: vi.fn(),
	renameTreeApi: vi.fn()
}));

const choice = { format: 'gedcom7', shouldCompress: false } as const;
const start = vi.mocked(startGedcomExport);
const status = vi.mocked(exportStatusApi);
const clearClientUuid = vi.mocked(clearExportClientUuid);
const isExpired = vi.mocked(isExpiredExportError);
const navigations: string[] = [];

function setup() {
	navigations.length = 0;
	sessionStorage.clear();
	vi.stubGlobal('window', {
		location: {
			set href(value: string) {
				navigations.push(value);
			},
			get href() {
				return navigations.at(-1) ?? '';
			}
		}
	});
	const toasts = new ToastStore();
	const shell = new TreeShell({
		treeId: () => 't1',
		toasts,
		reload: async () => {},
		goTo: () => {}
	});
	return { shell, toasts };
}

beforeEach(() => {
	vi.clearAllMocks();
});
afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

describe('TreeShell.exportGedcom', () => {
	it('navigates to the sync download when the tree is small', async () => {
		const { shell } = setup();
		start.mockResolvedValue({ status: 'sync' });
		await shell.exportGedcom(choice);
		expect(navigations).toEqual(['/api/export?treeId=t1&format=gedcom7']);
	});

	it('toasts when exports are unavailable, and never falls back to a sync download', async () => {
		const { shell, toasts } = setup();
		start.mockResolvedValue({ status: 'unavailable' });
		await shell.exportGedcom(choice);
		expect(navigations).toEqual([]);
		expect(toasts.items.at(-1)?.message).toContain('unavailable');
	});

	it('polls a started export until complete, then navigates to its download', async () => {
		vi.useFakeTimers();
		const { shell } = setup();
		start.mockResolvedValue({ status: 'started', instanceId: 'i1' });
		status
			.mockResolvedValueOnce({ status: 'running' })
			.mockResolvedValueOnce({ status: 'complete' });

		const running = shell.exportGedcom(choice);
		await vi.advanceTimersByTimeAsync(2_000);
		await vi.advanceTimersByTimeAsync(5_000);
		await running;

		expect(navigations).toEqual(['/api/export/download/i1']);
		expect(shell.pendingExportInstanceId).toBeNull();
	});

	it('toasts when the export errored', async () => {
		vi.useFakeTimers();
		const { shell, toasts } = setup();
		start.mockResolvedValue({ status: 'started', instanceId: 'i1' });
		status.mockResolvedValue({ status: 'errored' });

		const running = shell.exportGedcom(choice);
		await vi.advanceTimersByTimeAsync(2_000);
		await running;

		expect(navigations).toEqual([]);
		expect(toasts.items.at(-1)?.message).toContain('failed');
	});

	it('forgets the instance and client id when the export has expired, so the next click is new', async () => {
		vi.useFakeTimers();
		const { shell } = setup();
		start.mockResolvedValue({ status: 'started', instanceId: 'i1' });
		status.mockRejectedValue(new Error('gone'));
		isExpired.mockReturnValue(true);

		const running = shell.exportGedcom(choice);
		await vi.advanceTimersByTimeAsync(2_000);
		await running;

		expect(clearClientUuid).toHaveBeenCalledWith('t1', choice);
		expect(shell.pendingExportInstanceId).toBeNull();
		expect(sessionStorage.getItem('epoch.export.pending')).toBeNull();
	});

	it('keeps the instance and client id on a non-expiry failure, so the next click can resume', async () => {
		vi.useFakeTimers();
		const { shell } = setup();
		start.mockResolvedValue({ status: 'started', instanceId: 'i1' });
		status.mockRejectedValue(new Error('network'));
		isExpired.mockReturnValue(false);

		const running = shell.exportGedcom(choice);
		await vi.advanceTimersByTimeAsync(2_000);
		await running;

		expect(clearClientUuid).not.toHaveBeenCalled();
		expect(shell.pendingExportInstanceId).toBe('i1');
	});

	it('forgets the instance and client id when a resumed export has expired', async () => {
		vi.useFakeTimers();
		const { shell } = setup();
		start.mockResolvedValue({ status: 'started', instanceId: 'i1' });
		status.mockResolvedValue({ status: 'running' });

		const running = shell.exportGedcom(choice);
		await vi.advanceTimersByTimeAsync(200_000);
		await running;
		expect(shell.pendingExportInstanceId).toBe('i1');

		status.mockRejectedValue(new Error('gone'));
		isExpired.mockReturnValue(true);
		const resume = shell.resumeExport();
		await vi.advanceTimersByTimeAsync(2_000);
		await resume;

		expect(clearClientUuid).toHaveBeenCalledWith('t1', choice);
		expect(shell.pendingExportInstanceId).toBeNull();
	});

	it('forgets the client id once an export completes, so a later export is a new instance', async () => {
		vi.useFakeTimers();
		const { shell } = setup();
		start.mockResolvedValue({ status: 'started', instanceId: 'i1' });
		status.mockResolvedValueOnce({ status: 'complete' });

		const running = shell.exportGedcom(choice);
		await vi.advanceTimersByTimeAsync(2_000);
		await running;

		expect(clearClientUuid).toHaveBeenCalledWith('t1', choice);
	});

	it('keeps the client id when the poll times out, so a resume reuses its instance', async () => {
		vi.useFakeTimers();
		const { shell } = setup();
		start.mockResolvedValue({ status: 'started', instanceId: 'i1' });
		status.mockResolvedValue({ status: 'running' });

		const running = shell.exportGedcom(choice);
		await vi.advanceTimersByTimeAsync(200_000);
		await running;

		expect(shell.pendingExportInstanceId).toBe('i1');
		expect(clearClientUuid).not.toHaveBeenCalled();
	});
});

describe('TreeShell.resumeExport', () => {
	it('keeps the instance on timeout, then resumes it to a download', async () => {
		vi.useFakeTimers();
		const { shell } = setup();
		start.mockResolvedValue({ status: 'started', instanceId: 'i1' });
		status.mockResolvedValue({ status: 'running' });

		const running = shell.exportGedcom(choice);
		await vi.advanceTimersByTimeAsync(200_000);
		await running;
		expect(shell.pendingExportInstanceId).toBe('i1');
		expect(navigations).toEqual([]);

		status.mockResolvedValue({ status: 'complete' });
		const resume = shell.resumeExport();
		await vi.advanceTimersByTimeAsync(5_000);
		await resume;

		expect(navigations).toEqual(['/api/export/download/i1']);
		expect(shell.pendingExportInstanceId).toBeNull();
		expect(clearClientUuid).toHaveBeenCalledWith('t1', choice);
	});
});
