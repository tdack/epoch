import { DomainError } from '../domain/errors';

/**
 * The one place a route handler's failure becomes a response, so every endpoint answers the same
 * way: a `DomainError` keeps its own status and is reported as `{ error, code, details }`, and
 * anything else is a 500 that is logged once with its cause. `details` carries what a client needs
 * to act (the current version on a 409, the conflicts on a merge refusal), and is omitted from the
 * body when the error has none.
 *
 * @param fallback Names the operation ("Failed to create tree"); used as the message when the
 *   thrown value has none, and as the log label.
 * @param options.messagePrefix Prepended to an unexpected error's message, for endpoints whose
 *   clients show a generic failure ("Export failed: …").
 */
export function errorResponse(err: unknown, fallback: string, options: { messagePrefix?: string } = {}): Response {
	if (err instanceof DomainError) {
		return Response.json({ error: err.message, code: err.code, details: err.details }, { status: err.status });
	}
	console.error(`${fallback}:`, err);
	const message = (err as { message?: string } | null)?.message || fallback;
	return Response.json({ error: `${options.messagePrefix ?? ''}${message}` }, { status: 500 });
}
