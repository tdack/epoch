/** D1 refuses a LIKE/GLOB pattern longer than this many bytes (UTF-8), with a 500 rather than no match. */
const MAX_LIKE_PATTERN_BYTES = 50;

const encoder = new TextEncoder();

/**
 * A LIKE pattern for `text`, to use with `escape '\\'`: `%`, `_` and `\` escaped, wrapped in `head`
 * and `tail` (both `%` by default; search-repository passes spaces for word matching).
 *
 * The finished pattern is cut to {@link MAX_LIKE_PATTERN_BYTES} by dropping whole code points from
 * the end of `text`, not by rejecting it: a pasted long title should still find the record by its
 * opening. Code points are dropped one at a time, escape included, so neither a surrogate pair nor
 * a backslash pair is ever split.
 */
export function likePattern(text: string, head = '%', tail = '%'): string {
	let room = MAX_LIKE_PATTERN_BYTES - encoder.encode(head + tail).length;
	let out = '';
	for (const char of text) {
		const piece = /[\\%_]/.test(char) ? `\\${char}` : char;
		room -= encoder.encode(piece).length;
		if (room < 0) break;
		out += piece;
	}
	return head + out + tail;
}
