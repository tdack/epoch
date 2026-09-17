import type { Handle } from '@sveltejs/kit/hooks';
import { CF_ACCESS_TEAM_DOMAIN } from '$app/env/public';
import { CF_ACCESS_AUD, ACCESS_BYPASS_DEV } from '$app/env/private';
import { getPlatformBindings } from '#lib/server/platform.js';
import { extractAccessJwt, validateAccessJwt } from '#lib/server/auth/access.js';
import { getDb } from '#lib/server/db/index.js';
import { UserRepository } from '#lib/server/repositories/user-repository.js';
import { Logger } from '#lib/server/logging/logger.js';

export const handle: Handle = async ({ event, resolve }) => {
  const correlationId = event.request.headers.get('x-correlation-id') || crypto.randomUUID();
  event.locals.correlationId = correlationId;
  event.locals.user = null;

  const bindings = getPlatformBindings();

  // Populate event.platform for SvelteKit handlers expecting platform.env
  const mutableEvent = event as { platform?: { env?: unknown; context?: unknown; caches?: unknown } };
  if (!mutableEvent.platform) {
    mutableEvent.platform = { env: bindings, context: {}, caches: globalThis.caches };
  } else if (!mutableEvent.platform.env) {
    mutableEvent.platform.env = bindings;
  }

  const requestLogger = new Logger({ correlationId, path: event.url.pathname, method: event.request.method });

  const token = extractAccessJwt(event.request);
  const allowDevBypass =
    ACCESS_BYPASS_DEV === 'true' ||
    process.env.NODE_ENV !== 'production' ||
    process.env.ACCESS_BYPASS_DEV === 'true';

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
      requestLogger.warn('Cloudflare Access token validation failed', { error: err?.message });
    }
  } else if (allowDevBypass) {
    // Development / test fallback when running locally without active Access tunnel
    const devSub = event.request.headers.get('x-dev-user-sub') || 'dev-local-user';
    const devEmail = event.request.headers.get('x-dev-user-email') || 'developer@epoch.local';
    const devName = event.request.headers.get('x-dev-user-name') || 'Local Developer';

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

  const response = await resolve(event);
  response.headers.set('x-correlation-id', correlationId);
  return response;
};
