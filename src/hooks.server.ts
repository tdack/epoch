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
import { resolveUser } from '#lib/server/auth/resolve-user.js';
import {
	notAdmittedOutcome,
	isPublicTreeSegment,
	publicReadAccess,
	signedOutRedirect
} from '#lib/server/auth/public-routes.js';
import { NotAdmittedError } from '#lib/server/domain/errors.js';
import { PUBLIC_VISITOR } from '#lib/server/domain/identity.js';
import { getDb } from '#lib/server/db/index.js';
import { PublicTreeService } from '#lib/server/services/public-tree-service.js';
import { errorResponse } from '#lib/server/http/error-response.js';
import {
	isSchemaCurrent,
	SCHEMA_NOT_MIGRATED_CODE,
	SCHEMA_NOT_MIGRATED_MESSAGE
} from '#lib/server/db/schema-status.js';
import { Logger } from '#lib/server/logging/logger.js';

/** Who the dev bypass is without `x-dev-user-*`, and the install owner on a local database with no `install_meta` row. */
const DEV_BYPASS_EMAIL = 'developer@epoch.local';

export const handle: Handle = async ({ event, resolve }) => {
	const correlationId = event.request.headers.get('x-correlation-id') || crypto.randomUUID();
	event.locals.correlationId = correlationId;
	event.locals.user = null;
	event.locals.notAdmitted = null;

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
	// Fail closed: the bypass needs an explicit opt-in (the flag is never inferred from NODE_ENV,
	// since the unbundled server build keeps runtime env checks and would otherwise open production),
	// a dev build (below), and a local hostname, because only `/login` sits behind Access: a flag
	// left set on a deployment would open every other path.
	const isBypassFlagSet = isDevBypassEnabled(
		ACCESS_BYPASS_DEV,
		(bindings as { ACCESS_BYPASS_DEV?: string }).ACCESS_BYPASS_DEV
	);

	// Mirror the bypass flag: the build-time private env is the primary source, but the Worker
	// binding is a fallback for a deployment that wires the audience through `wrangler`/`.dev.vars`
	// alone. An empty result is not a skip: `validateAccessJwt` still fails closed on a non-dev token.
	const accessAud = CF_ACCESS_AUD || (bindings as { CF_ACCESS_AUD?: string }).CF_ACCESS_AUD;

	// Same fallback for the team domain: without it a deploy that supplies its config only through
	// bindings would clear the audience check and then fail here. An empty result still fails closed,
	// because `validateAccessJwt` refuses a token when the domain is absent.
	const accessTeamDomain =
		CF_ACCESS_TEAM_DOMAIN || (bindings as { CF_ACCESS_TEAM_DOMAIN?: string }).CF_ACCESS_TEAM_DOMAIN;
	// A production build replaces `import.meta.env.DEV` with `false`, so its bundle cannot be switched
	// on by the flag alone: the binding fallback above is read at runtime and would otherwise be
	// honoured by any deployed Worker that happens to carry the variable. Vite derives DEV from the
	// build mode, so a build run with NODE_ENV=development would keep the bypass compiled in.
	const isDevBuild = import.meta.env.DEV === true;
	const allowDevBypass = isDevBuild && isBypassFlagSet && isLocalHostname(event.url.hostname);
	if (isBypassFlagSet && !allowDevBypass) {
		requestLogger.warn('ACCESS_BYPASS_DEV is set but ignored: not a dev build on a local host', {
			hostname: event.url.hostname
		});
	}

	// Only the bypass may stand in for setup: anywhere else, an install with no owner recorded admits
	// members and invitees only, never whoever signs in first (ADR-034).
	const fallbackOwnerEmail = allowDevBypass ? DEV_BYPASS_EMAIL : null;

	if (token) {
		try {
			const validated = await validateAccessJwt(token, {
				teamDomain: accessTeamDomain,
				aud: accessAud,
				allowDevBypass
			});

			const admission = await resolveUser(bindings.DB, validated, {
				fallbackId: validated.id || crypto.randomUUID(),
				fallbackOwnerEmail
			});
			event.locals.user = admission.user;
			event.locals.notAdmitted = admission.notAdmitted;
		} catch (err: unknown) {
			hasInvalidToken = true;
			requestLogger.warn('Cloudflare Access token validation failed', {
				error: err instanceof Error ? err.message : String(err)
			});
		}
	} else if (allowDevBypass) {
		// Development / test fallback when running locally without active Access tunnel
		// A header, or the same name as a cookie: a page's server-side loads call the API with `event.fetch`,
		// which forwards cookies but not custom headers, so a second dev identity needs the cookie to be
		// the same user on the server render as in the browser. Reachable only with the bypass on.
		const devValue = (name: string) => event.request.headers.get(name) || event.cookies.get(name);
		const devSub = devValue('x-dev-user-sub') || 'dev-local-user';
		const devEmail = devValue('x-dev-user-email') || DEV_BYPASS_EMAIL;
		const devName = devValue('x-dev-user-name') || 'Local Developer';

		const admission = await resolveUser(
			bindings.DB,
			{ accessSub: devSub, email: devEmail, name: devName },
			{ fallbackId: 'dev-user-id', fallbackOwnerEmail }
		);
		event.locals.user = admission.user;
		event.locals.notAdmitted = admission.notAdmitted;
	}

	// The one public tree (ADR-041) is read by whoever asks. The lookup is one indexed read, made only
	// for an anonymous request on a tree page and never cached, so making the tree private takes
	// effect on the next request. The bypass is excluded so a local developer stays themself.
	const publicRead = allowDevBypass
		? null
		: publicReadAccess({
				pathname: event.url.pathname,
				method: event.request.method,
				hasToken: Boolean(token),
				hasUser: event.locals.user !== null
			});
	if (publicRead && bindings.DB) {
		const isPublicRead =
			publicRead.kind === 'api' ||
			isPublicTreeSegment(
				await new PublicTreeService(getDb(bindings.DB)).current(),
				publicRead.treeId
			);
		if (isPublicRead) event.locals.user = PUBLIC_VISITOR;
	}

	// Someone Access named but Epoch does not admit has no user, so nothing past here would serve
	// them anyway; this says so plainly, before the signed-out rules would send a page load to the
	// splash and an API call to a 401 that invites signing in again.
	const turnAway = notAdmittedOutcome({
		pathname: event.url.pathname,
		method: event.request.method,
		isDataRequest: event.isDataRequest,
		isNotAdmitted: event.locals.notAdmitted !== null
	});
	if (turnAway?.status === 303) {
		return new Response(null, {
			status: 303,
			headers: { location: turnAway.location, 'x-correlation-id': correlationId }
		});
	}
	if (turnAway?.status === 403) {
		const refusal = errorResponse(new NotAdmittedError(), 'Not admitted');
		refusal.headers.set('x-correlation-id', correlationId);
		return refusal;
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
	// Everything served to the anonymous reader stays out of search indexes (ADR-041).
	if (event.locals.user?.isPublicVisitor) response.headers.set('x-robots-tag', 'noindex');
	return response;
};
