import type { Handle } from '@sveltejs/kit/hooks';
import { CF_ACCESS_TEAM_DOMAIN } from '$app/env/public';
import { CF_ACCESS_AUD, ACCESS_BYPASS_DEV } from '$app/env/private';
import { getPlatformBindings } from '#lib/server/platform.js';
import {
	extractAccessJwt,
	isDevBypassEnabled,
	isLocalHostname,
	validateAccessJwt
} from '#lib/server/auth/access.js';
import { signedOutRedirect } from '#lib/server/auth/public-routes.js';
import { getDb } from '#lib/server/db/index.js';
import {
	isSchemaCurrent,
	SCHEMA_NOT_MIGRATED_CODE,
	SCHEMA_NOT_MIGRATED_MESSAGE
} from '#lib/server/db/schema-status.js';
import { UserRepository } from '#lib/server/repositories/user-repository.js';
import { Logger } from '#lib/server/logging/logger.js';

export const handle: Handle = async ({ event, resolve }) => {
	const correlationId = event.request.headers.get('x-correlation-id') || crypto.randomUUID();
	event.locals.correlationId = correlationId;
	event.locals.user = null;

	const bindings = getPlatformBindings();

	// Populate event.platform for SvelteKit handlers expecting platform.env
	const mutableEvent = event as {
		platform?: { env?: unknown; context?: unknown; caches?: unknown };
	};
	if (!mutableEvent.platform) {
		mutableEvent.platform = { env: bindings, context: {}, caches: globalThis.caches };
	} else if (!mutableEvent.platform.env) {
		mutableEvent.platform.env = bindings;
	}

	// Migrations under drizzle/ are the only schema source. Say so plainly instead of letting the
	// first query fail with `no such table`.
	if (bindings.DB && !(await isSchemaCurrent(bindings.DB))) {
		const isApi = event.url.pathname.startsWith('/api/');
		return isApi
			? Response.json(
					{ error: SCHEMA_NOT_MIGRATED_MESSAGE, code: SCHEMA_NOT_MIGRATED_CODE },
					{ status: 503, headers: { 'x-correlation-id': correlationId } }
				)
			: new Response(SCHEMA_NOT_MIGRATED_MESSAGE, {
					status: 503,
					headers: {
						'content-type': 'text/plain; charset=utf-8',
						'x-correlation-id': correlationId
					}
				});
	}

	const requestLogger = new Logger({
		correlationId,
		path: event.url.pathname,
		method: event.request.method
	});

	const token = extractAccessJwt(event.request);
	let hasInvalidToken = false;
	// Fail closed: the bypass needs an explicit opt-in and never follows NODE_ENV, since the
	// unbundled server build keeps runtime env checks and would otherwise open production. It also
	// needs a local hostname, because only `/login` sits behind Access: a flag left set on a
	// deployment would open every other path.
	const isBypassFlagSet = isDevBypassEnabled(
		ACCESS_BYPASS_DEV,
		(bindings as { ACCESS_BYPASS_DEV?: string }).ACCESS_BYPASS_DEV
	);
	const allowDevBypass = isBypassFlagSet && isLocalHostname(event.url.hostname);
	if (isBypassFlagSet && !allowDevBypass) {
		requestLogger.warn('ACCESS_BYPASS_DEV is set but ignored: the host is not local', {
			hostname: event.url.hostname
		});
	}

	if (token) {
		try {
			const validated = await validateAccessJwt(token, {
				teamDomain: CF_ACCESS_TEAM_DOMAIN,
				aud: CF_ACCESS_AUD,
				allowDevBypass
			});

			if (bindings.DB) {
				const db = getDb(bindings.DB);
				const userRepo = new UserRepository(db);
				const user = await userRepo.upsertFromAccess(validated);
				event.locals.user = user;
			} else {
				event.locals.user = {
					id: validated.id || crypto.randomUUID(),
					accessSub: validated.accessSub,
					email: validated.email,
					name: validated.name
				};
			}
		} catch (err: any) {
			hasInvalidToken = true;
			requestLogger.warn('Cloudflare Access token validation failed', { error: err?.message });
		}
	} else if (allowDevBypass) {
		// Development / test fallback when running locally without active Access tunnel
		// A header, or the same name as a cookie: a page's server-side loads call the API with `event.fetch`,
		// which forwards cookies but not custom headers, so a second dev identity needs the cookie to be
		// the same user on the server render as in the browser. Reachable only with the bypass on.
		const devValue = (name: string) => event.request.headers.get(name) || event.cookies.get(name);
		const devSub = devValue('x-dev-user-sub') || 'dev-local-user';
		const devEmail = devValue('x-dev-user-email') || 'developer@epoch.local';
		const devName = devValue('x-dev-user-name') || 'Local Developer';

		if (bindings.DB) {
			const db = getDb(bindings.DB);
			const userRepo = new UserRepository(db);
			const user = await userRepo.upsertFromAccess({
				accessSub: devSub,
				email: devEmail,
				name: devName
			});
			event.locals.user = user;
		} else {
			event.locals.user = {
				id: 'dev-user-id',
				accessSub: devSub,
				email: devEmail,
				name: devName
			};
		}
	}

	// Only `/login` sits behind Access, so every other path reaches the Worker signed out and this
	// is the gate. A page load goes to the splash (or to `/login` when a token failed validation);
	// an API call keeps its 401.
	const redirectTo = signedOutRedirect({
		pathname: event.url.pathname,
		search: event.url.search,
		method: event.request.method,
		isDataRequest: event.isDataRequest,
		hasUser: event.locals.user !== null,
		hasInvalidToken
	});
	if (redirectTo) {
		return new Response(null, {
			status: 303,
			headers: { location: redirectTo, 'x-correlation-id': correlationId }
		});
	}

	const response = await resolve(event);
	response.headers.set('x-correlation-id', correlationId);
	return response;
};
