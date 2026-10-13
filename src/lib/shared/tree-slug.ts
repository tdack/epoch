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

/** The segment a tree's pages live under: its slug when it has one, else its id. */
export function treeSegment(tree: { id: string; slug?: string | null }): string {
	return tree.slug ?? tree.id;
}

/** `/trees/<segment>`, the root every page of the tree hangs from. */
export function treePath(tree: { id: string; slug?: string | null }): string {
	return `/trees/${encodeURIComponent(treeSegment(tree))}`;
}
