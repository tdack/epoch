/**
 * The tab a page shows for the address's `#fragment`: one of `ids`, a section that lives inside a tab
 * (`within`, so old links such as `#visibility` still land), or the first tab.
 */
export function hashTab<T extends string>(
	hash: string,
	ids: readonly [T, ...T[]],
	within: Readonly<Record<string, T>> = {}
): T {
	const id = decodeURIComponent(hash.replace(/^#/, ''));
	return (ids as readonly string[]).includes(id) ? (id as T) : (within[id] ?? ids[0]);
}
