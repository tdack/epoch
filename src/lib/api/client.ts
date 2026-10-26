import { browser } from '$app/env';
import type { ApiErrorBody } from '#lib/shared/api-contracts.js';
import type { ChangeSummary } from '#lib/types/genealogy.js';

/** A failed API call, with the server's code and details so callers can react to specific cases. */
export class ApiError extends Error {
	constructor(
		message: string,
		readonly status: number,
		readonly code: string | undefined,
		readonly details: Record<string, unknown> | undefined
	) {
		super(message);
		this.name = 'ApiError';
	}
}

/** The record changed since it was loaded (HTTP 409, STALE_VERSION); `current` is what is stored now. */
export class ConflictError extends ApiError {
	constructor(
		message: string,
		status: number,
		code: string | undefined,
		readonly details: {
			reason: 'STALE_VERSION';
			entity:
				| 'individual'
				| 'union'
				| 'fact'
				| 'source'
				| 'repository'
				| 'citation'
				| 'source_link'
				| 'note'
				| 'note_link'
				| 'task'
				| 'subtree'
				| 'place_location'
				| 'media';
			id: string;
			expectedVersion: number;
			currentVersion: number;
			current: Record<string, unknown>;
		}
	) {
		super(message, status, code, details);
		this.name = 'ConflictError';
	}
}

export function isConflict(error: unknown): error is ConflictError {
	return error instanceof ConflictError;
}

/**
 * Whether a failed export call means the instance is gone for good: the workflow no longer knows it
 * (HTTP 404) or its file aged out (HTTP 410). A caller must then forget the instance and its client
 * id, so the next export starts a new instance rather than resuming one that can never succeed.
 */
export function isExpiredExportError(error: unknown): boolean {
	return error instanceof ApiError && (error.status === 404 || error.status === 410);
}

/**
 * Send the browser through `/login` after the session expired. It must be a full navigation, not
 * `goto`: only Access, which sees the request, can renew the cookie, and `/login` is the one path
 * it covers. Does nothing outside the browser.
 */
export function restartSignIn(): void {
	if (!browser) return;
	window.location.assign(
		`/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`
	);
}

export async function call<T>(
	url: string,
	init: RequestInit | undefined,
	failure: string,
	fetchFn: typeof fetch = fetch
): Promise<T> {
	const res = await fetchFn(url, init);
	// A body that is not JSON (a proxy's HTML error page) has none of these fields.
	const data = (await res.json().catch(() => ({}))) as Partial<ApiErrorBody>;
	if (!res.ok) {
		// The error is still thrown, so callers stop while the page navigates away.
		if (res.status === 401) restartSignIn();
		const message = data.error || failure;
		// Only a conflict that carries the stored values can be shown as a comparison; a bare
		// CONCURRENT_WRITE (a race inside the save) is reported as a plain error.
		if (res.status === 409 && data.details?.reason === 'STALE_VERSION' && data.details.current) {
			throw new ConflictError(
				message,
				res.status,
				data.code,
				data.details as ConflictError['details']
			);
		}
		throw new ApiError(message, res.status, data.code, data.details);
	}
	return data as unknown as T;
}

export const json = (method: string, body: unknown): RequestInit => ({
	method,
	headers: { 'Content-Type': 'application/json' },
	body: JSON.stringify(body)
});

/**
 * Builds a URL path with every interpolated part encoded, so an id or slug can never add a segment
 * or a query. A query string stays outside the tag, because its values are encoded separately.
 */
export function path(strings: TemplateStringsArray, ...parts: Array<string | number>): string {
	return strings.reduce(
		(url, text, index) =>
			url + text + (index < parts.length ? encodeURIComponent(String(parts[index])) : ''),
		''
	);
}

export type Changed = { change: ChangeSummary | null };

/** A merge or a delete that may be made in steps: `remaining` is what is left after this one. */
export type Stepped = Changed & { remaining: number };

/**
 * Repeats a change made in steps until nothing remains, calling `step` with what the last one left
 * (null the first time). Stops on the first error, or on a step that left as much as before. Each
 * step is its own undoable change; the last one's is returned.
 */
export async function runInSteps(
	step: (remaining: number | null) => Promise<Stepped>,
	onprogress?: (remaining: number) => void
): Promise<Stepped> {
	let result = await step(null);
	while (result.remaining > 0) {
		onprogress?.(result.remaining);
		const before = result.remaining;
		result = await step(before);
		if (result.remaining >= before)
			throw new Error('This stopped making progress, as someone else is changing it. Try again.');
	}
	return result;
}
