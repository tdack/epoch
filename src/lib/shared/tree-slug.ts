/**
 * A tree's readable address segment, `/trees/<slug>` (ADR-045). The id still works wherever a slug
 * does; the slug is preferred for every link Epoch builds.
 */

export const MAX_TREE_SLUG_LENGTH = 60;

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
// Tree ids are UUIDs. A slug shaped like one could be read as a different tree's id.
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Lower-case letters and digits in hyphen-separated words, no longer than the cap, never a UUID. */
export function isValidTreeSlug(value: string): boolean {
	return (
		value.length <= MAX_TREE_SLUG_LENGTH && SLUG_PATTERN.test(value) && !UUID_PATTERN.test(value)
	);
}

/**
 * A slug made from a tree's name, or null when the name has no Latin letters or digits to make one
 * from (a name in another script keeps its id as its address). Accents are dropped, so "Café" is
 * `cafe`.
 */
export function slugifyTreeName(name: string): string | null {
	const slug = name
		.normalize('NFKD')
		.replace(/[̀-ͯ]/g, '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.slice(0, MAX_TREE_SLUG_LENGTH)
		.replace(/^-+|-+$/g, '');
	return slug && isValidTreeSlug(slug) ? slug : null;
}

// Neither a slug nor a UUID can contain it, and `encodeURIComponent` leaves it alone.
const SUBTREE_SEPARATOR = '~';

/**
 * Splits the address segment after `/trees/` into the tree and the sub-tree riding inside it
 * (`dacks~bouvier-line`). The only code that knows the separator; an empty half counts as absent.
 */
export function splitTreeSegment(segment: string): { tree: string; subtree: string | null } {
	const at = segment.indexOf(SUBTREE_SEPARATOR);
	if (at === -1) return { tree: segment, subtree: null };
	return { tree: segment.slice(0, at), subtree: segment.slice(at + 1) || null };
}

/** What a link to a tree needs: its id, its slug when it has one, and the sub-tree lens when one is active. */
export interface TreeRef {
	id: string;
	slug?: string | null;
	/** The active sub-tree's slug (or id): links built from this ref keep the lens. */
	subtree?: string | null;
}

/** The segment a tree's pages live under: its slug when it has one, else its id, plus any lens. */
function treeSegment(tree: TreeRef): string {
	const base = tree.slug ?? tree.id;
	return tree.subtree ? `${base}${SUBTREE_SEPARATOR}${tree.subtree}` : base;
}

/**
 * The slug to hand a component that builds its links from `{ id, slug }` alone: the whole segment
 * (`dacks~bouvier-line`) while a lens is active, so those links keep it, else the plain slug.
 */
export function treeLinkSlug(tree: TreeRef): string | null {
	return tree.subtree ? treeSegment(tree) : (tree.slug ?? null);
}

/** `/trees/<segment>`, the root every page of the tree hangs from. */
export function treePath(tree: TreeRef): string {
	return `/trees/${encodeURIComponent(treeSegment(tree))}`;
}

/**
 * `/trees/<tree>~<subtree>` for a given sub-tree, replacing any lens `tree` already carries: a ref
 * from `treeLinkSlug` holds `dacks~a` as its slug, and appending to that would give `dacks~a~b`.
 */
export function subtreePath(tree: TreeRef, subtree: string): string {
	const base = splitTreeSegment(tree.slug ?? tree.id).tree;
	return treePath({ id: tree.id, slug: base, subtree });
}

/**
 * The same address under the tree's canonical segment, or null when `url` already uses it. Only
 * the segment after `/trees/` changes; the rest of the path and the query are kept.
 */
export function canonicalTreeAddress(
	url: { pathname: string; search: string },
	segment: string,
	tree: TreeRef
): string | null {
	const canonical = treeSegment(tree);
	if (segment === canonical) return null;
	const prefix = `/trees/${encodeURIComponent(segment)}`;
	const rest = url.pathname.startsWith(prefix) ? url.pathname.slice(prefix.length) : '';
	return `/trees/${encodeURIComponent(canonical)}${rest}${url.search}`;
}
