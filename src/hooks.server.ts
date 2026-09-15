import type { Handle } from '@sveltejs/kit';
import { extractAccessJwt, validateAccessJwt } from '$lib/server/auth/access';
import { getDb } from '$lib/server/db';
import { UserRepository } from '$lib/server/repositories/user-repository';
import { Logger } from '$lib/server/logging/logger';

export const handle: Handle = async ({ event, resolve }) => {
  const correlationId = event.request.headers.get('x-correlation-id') || crypto.randomUUID();
  event.locals.correlationId = correlationId;
  event.locals.user = null;

  const requestLogger = new Logger({ correlationId, path: event.url.pathname, method: event.request.method });

  const token = extractAccessJwt(event.request);
  const allowDevBypass =
    event.platform?.env?.ACCESS_BYPASS_DEV === 'true' ||
    process.env.NODE_ENV !== 'production' ||
    process.env.ACCESS_BYPASS_DEV === 'true';

  if (token) {
    try {
      const validated = await validateAccessJwt(token, {
        teamDomain: event.platform?.env?.CF_ACCESS_TEAM_DOMAIN,
        aud: event.platform?.env?.CF_ACCESS_AUD,
        allowDevBypass
      });

      if (event.platform?.env?.DB) {
        const db = getDb(event.platform.env.DB);
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

    if (event.platform?.env?.DB) {
      const db = getDb(event.platform.env.DB);
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
