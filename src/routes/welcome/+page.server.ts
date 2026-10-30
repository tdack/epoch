import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getDb } from '#lib/server/db/index.js';
import { PublicTreeService } from '#lib/server/services/public-tree-service.js';
import { LOGIN_PATH, SETUP_PATH, safeNextPath } from '#lib/server/auth/public-routes.js';
import { InstallRepository } from '#lib/server/repositories/install-repository.js';
import { parseWorkersDevHost } from '#lib/server/install/claim-install.js';
import { ACCESS_LOGOUT_PATH } from '#lib/shared/access.js';
import { treeHref } from '#lib/shared/tree-host.js';

// The page is served to visitors nobody has identified, so it ships no client code that could
// later be taught to call the API from here.
// SvelteKit reads this exact name, so it cannot take the boolean prefix.
// eslint-disable-next-line @typescript-eslint/naming-convention
export const csr = false;

type WelcomeState = 'signed-in' | 'signed-out' | 'not-invited';

export const load: PageServerLoad = async ({ locals, url, setHeaders, platform }) => {
	// The not-invited state names the visitor, so no cache may replay it to someone else.
	setHeaders({ 'cache-control': 'no-store' });
	const next = safeNextPath(url.searchParams.get('next'));
	// Decided from who is asking, never from `?reason=`, so a crafted link cannot show it to anyone else.
	const state: WelcomeState = locals.user
		? 'signed-in'
		: locals.notAdmitted
			? 'not-invited'
			: 'signed-out';
	const actionHrefs: Record<WelcomeState, string> = {
		// Signed in, there is nothing for Access to do; signed out, `/login` is the one path it covers.
		'signed-in': next,
		'signed-out': `${LOGIN_PATH}?next=${encodeURIComponent(next)}`,
		// "Continue" would come straight back here, and signing in again names the same person.
		'not-invited': ACCESS_LOGOUT_PATH
	};
	// Only a visitor nobody identified can use it: someone Access named is not served the public tree
	// anonymously, so the link would only bounce them back here. It names the tree and nothing in it.
	const db = platform?.env?.DB;
	// A button install's first visitor lands here with nothing able to sign them in, so they are sent
	// to the one page that can fix that (ADR-082). The host test comes first, so no install made by
	// `./setup` on its own domain pays the read.
	if (
		state === 'signed-out' &&
		db &&
		parseWorkersDevHost(url.hostname) &&
		!(await new InstallRepository(getDb(db)).hasOwner())
	) {
		redirect(303, SETUP_PATH);
	}
	const publicTree =
		state === 'signed-out' && db ? await new PublicTreeService(getDb(db)).current() : null;
	return {
		state,
		// On another tree's subdomain the public tree is not served, so the link leads to the app host.
		publicTree: publicTree
			? { name: publicTree.name, href: treeHref(publicTree, locals.hostTree) }
			: null,
		actionHref: actionHrefs[state],
		notAdmittedEmail: locals.notAdmitted?.email ?? null,
		// Link unfurlers need absolute URLs, and the host differs between preview and production.
		pageUrl: new URL(url.pathname, url.origin).href,
		imageUrl: new URL('/brand/og-image.png', url.origin).href
	};
};
