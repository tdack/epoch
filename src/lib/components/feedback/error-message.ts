/** Reads a thrown value's message, falling back when it is not an Error or the message is empty. */
export function messageOf(cause: unknown, fallback: string): string {
	return cause instanceof Error && cause.message ? cause.message : fallback;
}
