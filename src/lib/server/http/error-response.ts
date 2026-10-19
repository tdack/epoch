import { DomainError, RateLimitedError, type ErrorCode } from '../domain/errors';

/**
 * The one place a route handler's failure becomes a response, so every endpoint answers the same
 * way: a `DomainError` keeps its own status and is reported as `{ error, code, details }`, and
 * anything else is a 500 that is logged once with its cause. `details` carries what a client needs
 * to act (the current version on a 409, the conflicts on a merge refusal), and is omitted from the
 * body when the error has none.
 *
 * @param fallback Names the operation ("Failed to create tree"); the only text an unexpected error
 *   returns, and the log label.
 * @param options.messagePrefix Prepended to `fallback` in an unexpected error's body, for endpoints
 *   whose clients show a generic failure ("Export failed: …").
 */
export function errorResponse(
	err: unknown,
	fallback: string,
	options: { messagePrefix?: string } = {}
): Response {
	if (err instanceof DomainError) {
		return Response.json(
			{ error: err.message, code: err.code, details: err.details },
			{
				status: err.status,
				...(err instanceof RateLimitedError
					? { headers: { 'Retry-After': String(err.retryAfterSeconds) } }
					: {})
			}
		);
	}
	console.error(`${fallback}:`, err);
	// Never the thrown message: a driver error can carry SQL or schema names, and the cause is
	// already in the log above.
	const error = `${options.messagePrefix ?? ''}${fallback}`;
	const code: ErrorCode = 'INTERNAL_ERROR';
	return Response.json({ error, code }, { status: 500 });
}
