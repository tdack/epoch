/**
 * Transport helpers that parse a JSON request body with a Zod schema and map
 * failures onto the shared `ValidationError` so handlers keep a single error
 * envelope (or rethrow, letting the handler's DomainError catch-all format it).
 */

import { z } from 'zod';
import { ValidationError } from '../domain/errors';

/**
 * Parse an already-read JSON body against a schema. Returns the validated,
 * typed value. Throws `ValidationError` with a flattened message on failure, so
 * callers can let their existing `catch (e) { if (e instanceof DomainError) … }`
 * branch format the 400 response.
 */
export function parseBody<T extends z.ZodTypeAny>(schema: T, body: unknown): z.infer<T> {
	const result = schema.safeParse(body ?? {});
	if (!result.success) {
		throw new ValidationError(flattenZodError(result.error));
	}
	return result.data as z.infer<T>;
}

/** Flatten a Zod issue into a single readable line for the client. */
function flattenZodError(error: z.ZodError): string {
	const field = error.issues[0]?.path?.filter((p) => typeof p === 'string').join('.');
	const message = error.issues[0]?.message ?? 'Invalid request';
	return field ? `${field}: ${message}` : message;
}