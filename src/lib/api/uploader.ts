import {
	expectedPartBytes,
	type UploadCompleteDto,
	type UploadPurpose,
	type UploadSessionDto,
	type UploadSessionStateDto
} from '#lib/shared/uploads.js';
import { ApiError, call, json, path, restartSignIn } from './client.js';

/** Parts in flight at once: enough to fill a fast link, few enough to leave the page responsive. */
export const MAX_CONCURRENT_PARTS = 3;

/** Retries after the first try of one part, so a part is sent at most five times. */
export const MAX_PART_RETRIES = 4;

const BACKOFF_BASE_MS = 500;
const BACKOFF_CAP_MS = 15_000;

/** Bytes of the file delivered so far. `uploadedBytes` never exceeds `totalBytes`. */
export interface UploadProgress {
	uploadedBytes: number;
	totalBytes: number;
}

/** One part, handed to a `PartSender` exactly as the server's session described it. */
export interface PartRequest {
	url: string;
	method: string;
	body: Blob;
	signal: AbortSignal;
	/** Bytes of this part sent so far on this try. */
	onProgress: (loadedBytes: number) => void;
}

export interface PartResponse {
	status: number;
	bodyText: string;
}

/**
 * Sends one part and resolves with the HTTP answer whatever its status. It rejects only when no
 * answer came (a dropped connection) or the signal aborted; the uploader decides what to retry.
 */
export type PartSender = (request: PartRequest) => Promise<PartResponse>;

/** Seams for tests; every one defaults to the browser's own. */
export interface UploaderEnvironment {
	fetch?: typeof fetch;
	sendPart?: PartSender;
	sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
	/** In [0, 1); the jitter on each backoff. */
	random?: () => number;
	now?: () => number;
	/** Where a resumable session is remembered; null when there is none. */
	storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null;
}

export interface StartUploadOptions {
	file: File;
	treeId: string;
	purpose: UploadPurpose;
	onProgress?: (progress: UploadProgress) => void;
	/** Aborting stops the parts in flight, deletes the session and rejects with an `AbortError`. */
	signal?: AbortSignal;
	env?: UploaderEnvironment;
}

/**
 * XHR rather than fetch: `fetch` cannot report how much of a request body has gone, and a
 * 50 MiB part on a slow link would show no movement for minutes.
 */
export const xhrSendPart: PartSender = ({ url, method, body, signal, onProgress }) =>
	new Promise((resolve, reject) => {
		const xhr = new XMLHttpRequest();
		const abort = () => xhr.abort();
		xhr.upload.onprogress = (event) => onProgress(event.loaded);
		xhr.onload = () => {
			signal.removeEventListener('abort', abort);
			resolve({ status: xhr.status, bodyText: xhr.responseText });
		};
		xhr.onerror = xhr.ontimeout = () => {
			signal.removeEventListener('abort', abort);
			reject(new Error('The connection dropped'));
		};
		xhr.onabort = () => {
			signal.removeEventListener('abort', abort);
			reject(new DOMException('The upload was cancelled', 'AbortError'));
		};
		xhr.open(method, url);
		// The browser sets Content-Length from the Blob, which the server requires to match the part.
		signal.addEventListener('abort', abort, { once: true });
		if (signal.aborted) abort();
		else xhr.send(body);
	});

function sleepAbortable(ms: number, signal: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		const onAbort = () => {
			clearTimeout(timer);
			reject(new DOMException('The upload was cancelled', 'AbortError'));
		};
		const timer = setTimeout(() => {
			signal.removeEventListener('abort', onAbort);
			resolve();
		}, ms);
		signal.addEventListener('abort', onAbort, { once: true });
	});
}

export function isAbortError(error: unknown): boolean {
	return error instanceof DOMException && error.name === 'AbortError';
}

/** A network error and the answers that say "try again": a timeout, a rate limit, a server fault. */
export function isRetryableStatus(status: number): boolean {
	return status === 408 || status === 429 || status >= 500;
}

/** The pause before retry number `attempt` (1-based): exponential, capped, with up to half jittered off. */
export function backoffMs(attempt: number, random: number): number {
	const exponential = Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** (attempt - 1));
	return Math.round(exponential * (0.5 + random / 2));
}

// ---- Resume ---------------------------------------------------------------------------------

const RESUME_STORAGE_KEY = 'epoch.uploads.resumable';

/** What is kept to recognise the same file again; the part urls come back from the server. */
export interface ResumableUpload {
	sessionId: string;
	fileName: string;
	size: number;
	lastModified: number;
	treeId: string;
	purpose: UploadPurpose;
	/** Epoch milliseconds. */
	expiresAt: number;
}

type ResumeStore = NonNullable<UploaderEnvironment['storage']>;

function defaultStorage(): ResumeStore | null {
	try {
		return typeof localStorage === 'undefined' ? null : localStorage;
	} catch {
		return null;
	}
}

const resumeKey = (
	r: Pick<ResumableUpload, 'treeId' | 'purpose' | 'fileName' | 'size' | 'lastModified'>
) => [r.treeId, r.purpose, r.fileName, r.size, r.lastModified].join('\u0000');

function readRecords(store: ResumeStore | null): Record<string, ResumableUpload> {
	try {
		const raw = store?.getItem(RESUME_STORAGE_KEY);
		const parsed: unknown = raw ? JSON.parse(raw) : {};
		return parsed && typeof parsed === 'object' ? (parsed as Record<string, ResumableUpload>) : {};
	} catch {
		return {};
	}
}

function writeRecords(store: ResumeStore | null, records: Record<string, ResumableUpload>): void {
	try {
		if (Object.keys(records).length === 0) store?.removeItem(RESUME_STORAGE_KEY);
		else store?.setItem(RESUME_STORAGE_KEY, JSON.stringify(records));
	} catch {
		// Only the chance to resume is lost; the upload itself does not depend on it.
	}
}

/** The remembered session for this very file, if it has not run out. */
export function findResumable(
	store: ResumeStore | null,
	file: Pick<File, 'name' | 'size' | 'lastModified'>,
	treeId: string,
	purpose: UploadPurpose,
	nowMs: number
): ResumableUpload | null {
	const found =
		readRecords(store)[
			resumeKey({
				treeId,
				purpose,
				fileName: file.name,
				size: file.size,
				lastModified: file.lastModified
			})
		];
	return found && found.expiresAt > nowMs ? found : null;
}

function forget(store: ResumeStore | null, record: Parameters<typeof resumeKey>[0]): void {
	const records = readRecords(store);
	delete records[resumeKey(record)];
	writeRecords(store, records);
}

function remember(store: ResumeStore | null, record: ResumableUpload): void {
	writeRecords(store, { ...readRecords(store), [resumeKey(record)]: record });
}

// ---- Upload ---------------------------------------------------------------------------------

function abortError(): DOMException {
	return new DOMException('The upload was cancelled', 'AbortError');
}

async function apiErrorOf(response: PartResponse): Promise<ApiError> {
	let body: { error?: string; code?: string; details?: Record<string, unknown> } = {};
	try {
		body = JSON.parse(response.bodyText) as typeof body;
	} catch {
		// A proxy's HTML error page has no fields to read.
	}
	if (response.status === 401) restartSignIn();
	return new ApiError(
		body.error || 'A part of the upload failed',
		response.status,
		body.code,
		body.details
	);
}

function missingPartsOf(error: unknown): number[] | null {
	if (!(error instanceof ApiError) || error.status !== 400) return null;
	const missing = error.details?.missingParts;
	return Array.isArray(missing) && missing.every((n) => Number.isInteger(n))
		? (missing as number[])
		: null;
}

/**
 * Uploads `file` in parts and resolves with the completed session. The part urls are the
 * server's, used as given, so a pre-signed address needs no change here.
 *
 * A failed part is retried (network errors, 408, 429, 5xx) with growing, jittered pauses; any
 * other failure stops the upload and leaves the session for a later resume. Cancelling deletes
 * the session. The same file picked again resumes the session, sending only the parts the server
 * lacks.
 */
export async function startUpload(options: StartUploadOptions): Promise<UploadCompleteDto> {
	const { file, treeId, purpose, onProgress, signal: outer } = options;
	const env = options.env ?? {};
	const fetchFn = env.fetch ?? fetch;
	const sendPart = env.sendPart ?? xhrSendPart;
	const sleep = env.sleep ?? sleepAbortable;
	const random = env.random ?? Math.random;
	const now = env.now ?? Date.now;
	const store = env.storage === undefined ? defaultStorage() : env.storage;

	if (file.size === 0) throw new Error('This file is empty');
	if (outer?.aborted) throw abortError();

	// Separate from the caller's signal so one part's fatal failure can stop its siblings.
	const inner = new AbortController();
	const onOuterAbort = () => inner.abort();
	outer?.addEventListener('abort', onOuterAbort, { once: true });

	let session: UploadSessionDto | null = null;
	const sentBytes = new Map<number, number>();
	const report = () => {
		let uploaded = 0;
		for (const bytes of sentBytes.values()) uploaded += bytes;
		onProgress?.({ uploadedBytes: Math.min(uploaded, file.size), totalBytes: file.size });
	};

	const sendOne = async (part: UploadSessionDto['parts'][number]): Promise<void> => {
		const size = expectedPartBytes(part.partNumber, file.size, session!.partSizeBytes);
		const offset = (part.partNumber - 1) * session!.partSizeBytes;
		const blob = file.slice(offset, offset + size);
		let lastError: unknown = null;
		for (let attempt = 0; attempt <= MAX_PART_RETRIES; attempt++) {
			if (attempt > 0) await sleep(backoffMs(attempt, random()), inner.signal);
			sentBytes.set(part.partNumber, 0);
			report();
			let response: PartResponse;
			try {
				response = await sendPart({
					url: part.url,
					method: part.method,
					body: blob,
					signal: inner.signal,
					onProgress: (loaded) => {
						sentBytes.set(part.partNumber, Math.min(loaded, size));
						report();
					}
				});
			} catch (error) {
				if (inner.signal.aborted) throw isAbortError(error) ? error : abortError();
				lastError = new Error(
					'The connection dropped while uploading. Check your connection and try again.'
				);
				continue;
			}
			if (response.status >= 200 && response.status < 300) {
				sentBytes.set(part.partNumber, size);
				report();
				return;
			}
			lastError = await apiErrorOf(response);
			if (!isRetryableStatus(response.status)) throw lastError;
		}
		throw lastError;
	};

	const sendParts = async (numbers: number[]): Promise<void> => {
		const queue = numbers.map((n) => session!.parts.find((p) => p.partNumber === n)!);
		let failure: unknown = null;
		const worker = async () => {
			while (failure === null && queue.length > 0) {
				try {
					await sendOne(queue.shift()!);
				} catch (error) {
					failure ??= error;
					inner.abort();
				}
			}
		};
		await Promise.all(Array.from({ length: Math.min(MAX_CONCURRENT_PARTS, queue.length) }, worker));
		if (failure !== null) throw failure;
	};

	const record = (s: UploadSessionDto): ResumableUpload => ({
		sessionId: s.sessionId,
		fileName: file.name,
		size: file.size,
		lastModified: file.lastModified,
		treeId,
		purpose,
		expiresAt: s.expiresAt
	});

	try {
		let received: number[] = [];
		const remembered = findResumable(store, file, treeId, purpose, now());
		if (remembered) {
			try {
				const state = await call<UploadSessionStateDto>(
					path`/api/uploads/${remembered.sessionId}`,
					{ signal: inner.signal },
					'Failed to resume the upload',
					fetchFn
				);
				session = state;
				received = state.receivedParts;
			} catch (error) {
				if (inner.signal.aborted) throw error;
				// Expired, finished elsewhere or gone: start over rather than fail.
				forget(store, remembered);
			}
		}
		if (!session) {
			session = await call<UploadSessionDto>(
				'/api/uploads',
				{
					...json('POST', {
						treeId,
						purpose,
						fileName: file.name,
						contentType: file.type,
						totalBytes: file.size
					}),
					signal: inner.signal
				},
				'Failed to start the upload',
				fetchFn
			);
			remember(store, record(session));
		}
		for (const n of received)
			sentBytes.set(n, expectedPartBytes(n, file.size, session.partSizeBytes));
		report();

		const all = session.parts.map((p) => p.partNumber);
		await sendParts(all.filter((n) => !received.includes(n)));

		const completeUrl = path`/api/uploads/${session.sessionId}/complete`;
		const complete = () =>
			call<UploadCompleteDto>(
				completeUrl,
				{ method: 'POST', signal: inner.signal },
				'Failed to finish the upload',
				fetchFn
			);
		let done: UploadCompleteDto;
		try {
			done = await complete();
		} catch (error) {
			const missing = missingPartsOf(error);
			if (!missing) throw error;
			// The server lost track of these (or never got them); one more send, then it is final.
			await sendParts(missing);
			done = await complete();
		}
		forget(store, record(session));
		return done;
	} catch (error) {
		if (outer?.aborted) {
			if (session) {
				forget(store, record(session));
				// Best effort: an upload we cannot delete is swept when its session expires.
				await call(
					path`/api/uploads/${session.sessionId}`,
					{ method: 'DELETE' },
					'Failed to cancel the upload',
					fetchFn
				).catch(() => undefined);
			}
			throw abortError();
		}
		throw error;
	} finally {
		outer?.removeEventListener('abort', onOuterAbort);
	}
}
