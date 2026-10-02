/**
 * Compact URL tokens for opened "+N" stubs, shared by the browser (which writes them into the
 * address) and the graph endpoint (which resolves them while it walks, so it fetches the extra
 * generation an opened stub reveals). Browser-safe: no imports.
 */

/** Deepest ancestor or descendant depth a view may ask for. */
export const MAX_VIEW_DEPTH = 8;

/** `a.1a2b3c4d`: a kind letter, a dot, and the first characters of the id the stub hangs from. */
export const STUB_TOKEN = /^[aduo]\.[\w-]{1,8}$/;

const STUB_KIND_LETTERS = [
	['stub:ancestors:', 'a'],
	['stub:children:direct:', 'd'],
	['stub:children:other:', 'o'],
	['stub:children:', 'u']
] as const;

/** 32-bit FNV-1a, in base 36: at most seven characters. */
function shortHash(text: string): string {
	let hash = 0x811c9dc5;
	for (let i = 0; i < text.length; i++) {
		hash ^= text.charCodeAt(i);
		hash = Math.imul(hash, 0x01000193);
	}
	return (hash >>> 0).toString(36);
}

/**
 * A short URL form of a stub id. Ids are long (UUIDs, and here prefixed with the tree's id, so a
 * prefix alone cannot tell two people apart), so a few opened stubs would otherwise run to several
 * hundred characters. A hash keeps each to a handful; a clash would open a stub the person did not
 * ask for, which is harmless because a stub only reveals relatives.
 */
export function compactStubId(stubId: string): string | null {
	for (const [prefix, letter] of STUB_KIND_LETTERS) {
		if (stubId.startsWith(prefix)) return `${letter}.${shortHash(stubId.slice(prefix.length))}`;
	}
	return null;
}

/** The full stub ids the tokens stand for, out of every stub the graph could have. */
export function resolveStubTokens(
	tokens: readonly string[],
	personIds: readonly string[],
	unionIds: readonly string[]
): string[] {
	if (tokens.length === 0) return [];
	const wanted = new Set(tokens);
	const candidates = [
		...personIds.flatMap((id) => [
			`stub:ancestors:${id}`,
			`stub:children:direct:${id}`,
			`stub:children:other:${id}`
		]),
		...unionIds.map((id) => `stub:children:${id}`)
	];
	return candidates.filter((id) => {
		const token = compactStubId(id);
		return token !== null && wanted.has(token);
	});
}
