import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastStore } from '#lib/components/feedback/toasts.svelte.js';
import {
	clearExportClientUuid,
	exportStatusApi,
	importStatusApi,
	previewGedzipImport,
	startGedcomExport,
	startGedzipImport,
	submitGedcomImport
} from '#lib/api/files.js';
import { ApiError, isExpiredExportError } from '#lib/api/client.js';
import { startUpload } from '#lib/api/uploader.js';
import { TreeShell } from './tree-shell.svelte.js';

vi.mock('#lib/api/client.js', () => ({
	isExpiredExportError: vi.fn(),
	ApiError: class ApiError extends Error {
		constructor(
			message: string,
			readonly status: number
		) {
			super(message);
		}
	}
}));

vi.mock('#lib/api/uploader.js', () => ({
	startUpload: vi.fn(),
	isAbortError: (e: unknown) => e instanceof DOMException && e.name === 'AbortError'
}));

vi.mock('#lib/api/files.js', () => ({
	previewGedcomImport: vi.fn(),
	previewGedzipImport: vi.fn(),
	startGedzipImport: vi.fn(),
	submitGedcomImport: vi.fn(),
	importStatusApi: vi.fn(),
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

describe('TreeShell.confirmImport for a queued import', () => {
	const submit = vi.mocked(submitGedcomImport);
	const importStatus = vi.mocked(importStatusApi);
	const COUNTS = { individualsCount: 7, familiesCount: 3, eventsCount: 0, mergedFamiliesCount: 0 };

	function queued() {
		const ctx = setup();
		ctx.shell.pendingImportFile = new File(['x'], 'big.ged');
		submit.mockResolvedValue({ status: 'queued', treeId: 't1', jobId: 'j1' });
		return ctx;
	}

	it('polls the job and reports its counts when it completes', async () => {
		vi.useFakeTimers();
		const { shell } = queued();
		importStatus
			.mockResolvedValueOnce({ status: 'running' })
			.mockResolvedValueOnce({ status: 'complete', result: COUNTS });

		const running = shell.confirmImport('replace', { shouldMergeDuplicateFamilies: false });
		await vi.advanceTimersByTimeAsync(2_000);
		await vi.advanceTimersByTimeAsync(5_000);
		await running;

		expect(importStatus).toHaveBeenCalledWith('j1');
		expect(shell.importStatus).toBe('Import complete: 7 individuals, 3 families.');
		expect(shell.importConfirmError).toBeNull();
	});

	it('shows the job’s error when it fails', async () => {
		vi.useFakeTimers();
		const { shell } = queued();
		importStatus.mockResolvedValue({ status: 'failed', error: 'The file is too large to import.' });

		const running = shell.confirmImport('replace', { shouldMergeDuplicateFamilies: false });
		await vi.advanceTimersByTimeAsync(2_000);
		await running;

		expect(shell.importConfirmError).toBe('The file is too large to import.');
		expect(shell.importStatus).toBeNull();
	});
});

describe('TreeShell with an uploaded .gdz', () => {
	const importStatus = vi.mocked(importStatusApi);
	const MEDIA = {
		resolved: 2,
		unresolved: 3,
		detachedAdded: 2,
		skippedByType: 1,
		overCap: 0,
		overQuota: 0,
		unreadable: 0
	};

	async function previewed() {
		const ctx = setup();
		vi.mocked(startUpload).mockResolvedValue({ sessionId: 's1', r2Key: 'k', totalBytes: 1 });
		vi.mocked(previewGedzipImport).mockResolvedValue({
			mode: 'replace',
			incoming: { individuals: 1, families: 0, events: 0 },
			duplicates: { exact: [], possible: [] },
			retainedTags: []
		});
		ctx.shell.importFile(new File(['x'], 'tree.gdz'));
		await vi.waitFor(() => expect(ctx.shell.importPreview).not.toBeNull());
		return ctx;
	}

	it('uploads first, then previews the session', async () => {
		const { shell } = await previewed();
		expect(startUpload).toHaveBeenCalledWith(
			expect.objectContaining({ treeId: 't1', purpose: 'gedzip_import' })
		);
		expect(previewGedzipImport).toHaveBeenCalledWith('s1');
		expect(shell.importUpload).toBeNull();
		expect(shell.isImportConfirmModalOpen).toBe(true);
	});

	it('reports batch progress, then the media counts in words', async () => {
		vi.useFakeTimers();
		const { shell } = await previewed();
		vi.mocked(startGedzipImport).mockResolvedValue({ status: 'queued', treeId: 't1', jobId: 'j1' });
		importStatus
			.mockResolvedValueOnce({ status: 'running', progress: { done: 100, total: 250 } })
			.mockResolvedValueOnce({
				status: 'complete',
				result: {
					individualsCount: 7,
					familiesCount: 3,
					eventsCount: 0,
					mergedFamiliesCount: 0,
					media: MEDIA
				}
			});

		const running = shell.confirmImport('replace', { shouldMergeDuplicateFamilies: false });
		await vi.advanceTimersByTimeAsync(2_000);
		expect(shell.importProgressText).toBe('Storing files: 100 of 250 handled.');
		await vi.advanceTimersByTimeAsync(5_000);
		await running;

		expect(startGedzipImport).toHaveBeenCalledWith('s1', {
			mode: 'replace',
			shouldMergeDuplicateFamilies: false
		});
		expect(shell.importStatus).toBe(
			'Import complete: 7 individuals, 3 families. Media: 4 files stored (2 not linked to any record); 3 files are still missing; 1 skipped as a type Epoch does not accept.'
		);
	});

	it('keeps polling past the timeout while files are still being stored', async () => {
		vi.useFakeTimers();
		const { shell } = await previewed();
		vi.mocked(startGedzipImport).mockResolvedValue({ status: 'queued', treeId: 't1', jobId: 'j1' });
		let done = 0;
		importStatus.mockImplementation(async () =>
			++done < 120
				? { status: 'running', progress: { done, total: 120 } }
				: {
						status: 'complete',
						result: {
							individualsCount: 1,
							familiesCount: 0,
							eventsCount: 0,
							mergedFamiliesCount: 0,
							media: MEDIA
						}
					}
		);

		const running = shell.confirmImport('replace', { shouldMergeDuplicateFamilies: false });
		await vi.advanceTimersByTimeAsync(1_500_000);
		await running;

		expect(shell.importStatus).toMatch(/^Import complete/);
	});

	it('says so when the upload was already imported', async () => {
		const { shell } = await previewed();
		vi.mocked(startGedzipImport).mockRejectedValue(
			new ApiError('This upload has already been imported', 409, undefined, undefined)
		);
		await shell.confirmImport('replace', { shouldMergeDuplicateFamilies: false });
		expect(shell.importConfirmError).toBe(
			'This file has already been imported. Close this and choose it again to import it again.'
		);
	});

	it('shows the failed job’s fixed message', async () => {
		vi.useFakeTimers();
		const { shell } = await previewed();
		vi.mocked(startGedzipImport).mockResolvedValue({ status: 'queued', treeId: 't1', jobId: 'j1' });
		importStatus.mockResolvedValue({
			status: 'failed',
			error: 'The file is not a valid .gdz archive.'
		});
		const running = shell.confirmImport('replace', { shouldMergeDuplicateFamilies: false });
		await vi.advanceTimersByTimeAsync(2_000);
		await running;
		expect(shell.importConfirmError).toBe('The file is not a valid .gdz archive.');
	});

	it('keeps the failure on the upload so it can be retried', async () => {
		const { shell } = setup();
		vi.mocked(startUpload).mockRejectedValue(new Error('The connection dropped.'));
		shell.importFile(new File(['x'], 'tree.gdz'));
		await vi.waitFor(() => expect(shell.importUpload?.phase).toBe('failed'));
		expect(shell.importUpload?.error).toBe('The connection dropped.');
	});
});
