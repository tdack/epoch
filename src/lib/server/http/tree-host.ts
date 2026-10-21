import { isValidTreeSlug } from '../../shared/tree-slug';
import { LOGIN_PATH, WELCOME_PATH, treeIdOfPath } from '../auth/public-routes';

/**
 * Labels no tree may take as its subdomain, whatever the install's own list says. A name the zone
 * already uses elsewhere (a website on `www`, a second install on `demo`) goes in
 * `EPOCH_RESERVED_SUBDOMAINS` instead, since only the install knows its zone.
 */
const BUILT_IN_RESERVED_LABELS: readonly string[] = ['www', 'api', 'mail', 'login', 'welcome'];

export interface TreeHostConfig {
	/** Trees are served at `<slug>.<zone>`. */
	zone: string;
	/** Where the whole install is served; the zone itself unless `EPOCH_APP_HOST` names a sibling. */
	appHost: string;
	/**
	 * Labels no tree may take. A request on one gets the bare 404: a name with no DNS record of its
	 * own reaches the Worker through the wildcard, and must not become a second copy of the app.
	 */
	reserved: ReadonlySet<string>;
}

interface TreeHostEnv {
	EPOCH_TREE_HOST_ZONE?: string;
	EPOCH_APP_HOST?: string;
	EPOCH_RESERVED_SUBDOMAINS?: string;
}

/** The install's subdomain settings, or null when `EPOCH_TREE_HOST_ZONE` is unset and the feature is off. */
export function treeHostConfig(env: TreeHostEnv | undefined): TreeHostConfig | null {
	const zone = env?.EPOCH_TREE_HOST_ZONE?.trim().toLowerCase();
	if (!zone) return null;
	const appHost = env?.EPOCH_APP_HOST?.trim().toLowerCase() || zone;
	const listed = (env?.EPOCH_RESERVED_SUBDOMAINS ?? '')
		.split(',')
		.map((label) => label.trim().toLowerCase())
		.filter(Boolean);
	// An app host beside the trees (`epoch.example.com`) must never be read as a tree called `epoch`.
	const appLabel = appHost.endsWith(`.${zone}`) ? appHost.slice(0, -zone.length - 1) : null;
	return {
		zone,
		appHost,
		reserved: new Set([...BUILT_IN_RESERVED_LABELS, ...listed, ...(appLabel ? [appLabel] : [])])
	};
}

/** Why `label` cannot be a subdomain, or null when it can. */
export function subdomainRefusal(label: string | null, config: TreeHostConfig): string | null {
	if (label === null) return 'Give the tree an address first; its subdomain is its address';
	if (config.reserved.has(label)) return `"${label}" is reserved and cannot be a tree's subdomain`;
	return null;
}

/**
 * What a request's hostname is to Epoch.
 *
 * - `app`: served as the whole install. This is also every host outside the zone, such as a
 *   `workers.dev` address kept during a move, so setting the variable never cuts one off.
 * - `tree`: one label under the zone, which may name a tree; the caller looks it up.
 * - `unknown`: under the zone but never a tree (deeper names, labels no slug can be, reserved
 *   labels). Refused like a label that names no tree. A name the zone serves elsewhere (`www`)
 *   never reaches the Worker: its own route excludes it.
 */
export type HostKind = { kind: 'app' } | { kind: 'tree'; label: string } | { kind: 'unknown' };

export function classifyHost(hostname: string, config: TreeHostConfig | null): HostKind {
	if (!config) return { kind: 'app' };
	const host = hostname.toLowerCase();
	if (host === config.zone || host === config.appHost) return { kind: 'app' };
	if (!host.endsWith(`.${config.zone}`)) return { kind: 'app' };
	const label = host.slice(0, -config.zone.length - 1);
	if (label.includes('.') || !isValidTreeSlug(label)) return { kind: 'unknown' };
	if (config.reserved.has(label)) return { kind: 'unknown' };
	return { kind: 'tree', label };
}

/** The app host's origin, keeping the request's scheme and port so `dacks.localhost:5173` leads to `localhost:5173`. */
export function appOrigin(url: URL, config: TreeHostConfig): string {
	return `${url.protocol}//${config.appHost}${url.port ? `:${url.port}` : ''}`;
}

/** Pages that span trees: on a tree host they are served from the app host instead. */
const INSTALL_WIDE_TREE_PAGES: readonly string[] = ['trees', 'files'];
const INSTALL_WIDE_PREFIXES: readonly string[] = [
	'/account',
	'/admin',
	'/profile',
	'/settings',
	'/manage'
];

/**
 * What a tree host does with a path, so that the host shows only its own tree.
 *
 * This is about what is shown, not who may see it: the same person has the same rights on every
 * host, so an API path that is not about one tree (a file upload, an export) is served as it is
 * on the app host, and its own checks apply. Only `/api/trees/<other>` is refused, so a page on
 * this host cannot be pointed at another tree's data by its address.
 */
export type TreeHostRoute =
	| { action: 'serve' }
	| { action: 'redirect'; location: string }
	| { action: 'app'; path: string }
	| { action: 'not-found' };

export function treeHostRoute(
	url: { pathname: string; search: string },
	tree: { id: string; slug: string }
): TreeHostRoute {
	const { pathname, search } = url;
	const isThisTree = (segment: string) => segment === tree.id || segment === tree.slug;
	if (pathname === '/') return { action: 'redirect', location: `/trees/${tree.slug}${search}` };
	if (pathname === WELCOME_PATH || pathname === LOGIN_PATH) return { action: 'serve' };
	if (pathname.startsWith('/api/')) {
		const segment = treeIdOfPath(pathname.slice('/api'.length));
		return segment !== null && !isThisTree(segment) ? { action: 'not-found' } : { action: 'serve' };
	}
	const segment = treeIdOfPath(pathname);
	if (segment !== null) {
		if (!isThisTree(segment)) return { action: 'not-found' };
		const page = pathname.split('/')[3];
		return page !== undefined && INSTALL_WIDE_TREE_PAGES.includes(page)
			? { action: 'app', path: pathname + search }
			: { action: 'serve' };
	}
	if (
		INSTALL_WIDE_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))
	)
		return { action: 'app', path: pathname + search };
	return { action: 'serve' };
}
