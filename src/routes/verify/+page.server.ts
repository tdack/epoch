import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { getPlatformBindings } from '#lib/server/platform.js';
import { LOGIN_PATH, safeNextPath } from '#lib/server/auth/public-routes.js';
import {
	PUBLIC_PASS_COOKIE,
	PUBLIC_PASS_TTL_SECONDS,
	PUBLIC_READ_ACTION,
	issuePublicPass,
	verifyTurnstileToken
} from '#lib/server/auth/public-pass.js';

// Served to visitors nobody has identified; Turnstile's own script is the only client code it needs.
// SvelteKit reads this exact name, so it cannot take the boolean prefix.
// eslint-disable-next-line @typescript-eslint/naming-convention
export const csr = false;

export const load: PageServerLoad = ({ locals, url, setHeaders }) => {
	setHeaders({ 'cache-control': 'no-store' });
	const next = safeNextPath(url.searchParams.get('next'));
	const siteKey = getPlatformBindings().TURNSTILE_SITE_KEY;
	// A member, or an install without the gate, has nothing to solve.
	if (locals.user || !siteKey) redirect(303, next);
	return {
		siteKey,
		action: PUBLIC_READ_ACTION,
		next,
		signInHref: `${LOGIN_PATH}?next=${encodeURIComponent(next)}`
	};
};

export const actions: Actions = {
	default: async ({ request, url, cookies }) => {
		const secret = getPlatformBindings().TURNSTILE_SECRET;
		const form = await request.formData();
		const next = safeNextPath(String(form.get('next') ?? ''));
		const isHuman =
			Boolean(secret) &&
			(await verifyTurnstileToken({
				secret: secret!,
				token: form.get('cf-turnstile-response'),
				remoteIp: request.headers.get('cf-connecting-ip'),
				hostname: url.hostname
			}));
		if (!isHuman) return fail(403, { failed: true });
		cookies.set(PUBLIC_PASS_COOKIE, await issuePublicPass(secret!), {
			path: '/',
			httpOnly: true,
			secure: true,
			sameSite: 'lax',
			maxAge: PUBLIC_PASS_TTL_SECONDS
		});
		redirect(303, next);
	}
};
