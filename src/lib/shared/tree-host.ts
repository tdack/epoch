import { treePath, type TreeRef } from './tree-slug';

/** The tree a page's host is pinned to (`dacks.example.com`), and how to reach the rest of the install. */
export interface HostTree {
	id: string;
	slug: string;
	/** The app host's origin, with the request's scheme and port. */
	appOrigin: string;
}

/**
 * Where a link to `tree` goes from the current page. On a tree host only its own tree is served,
 * so any other tree is reached on the app host, with a full page load.
 */
export function treeHref(tree: TreeRef, hostTree: HostTree | null): string {
	if (!hostTree || tree.id === hostTree.id) return treePath(tree);
	return `${hostTree.appOrigin}${treePath(tree)}`;
}

/** An install-wide page (`/`, the Trees page, settings): on a tree host it lives on the app host. */
export function appHref(path: string, hostTree: HostTree | null): string {
	return hostTree ? `${hostTree.appOrigin}${path}` : path;
}

/** `https://<slug>.<zone>` with the current page's scheme and port. */
export function subdomainOrigin(
	slug: string,
	zone: string,
	current: { protocol: string; port: string }
): string {
	return `${current.protocol}//${slug}.${zone}${current.port ? `:${current.port}` : ''}`;
}

/** Whether `href` leaves this origin, so it needs a full page load rather than client-side routing. */
export function isOtherOrigin(href: string): boolean {
	return /^[a-z][a-z0-9+.-]*:\/\//i.test(href);
}
