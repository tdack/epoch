import { ERROR_CODES, SetupError } from './errors.ts';
import { AUTH_MODES, type AuthMode } from './manifest.ts';

/**
 * Requested `cf` OAuth scopes (plan, "Decision"). Names are from the plan's reading of the
 * client's registered scopes; SPIKE: confirm each name. Zero Trust is read-only except apps and
 * policies, so the login cannot change the organisation, identity providers or groups.
 */
export const BASE_SCOPES = [
	'account:read',
	'user:read',
	'zone.read',
	'dns.read',
	'd1.write',
	'workers-r2.write',
	'queues.write',
	'workers-scripts.write',
	'workers-routes.read',
	'access-org.read',
	'access-idp.read',
	'access-app.write',
	'access-policy.read',
	'access-policy.write',
	'email-sending.read'
] as const;

/** Broad, so asked for only when the user chose a minted deploy token. */
const EPHEMERAL_SCOPE = 'account_api_tokens:create';

export function requestedScopes(mode: AuthMode): string[] {
	return mode === AUTH_MODES.ephemeral ? [...BASE_SCOPES, EPHEMERAL_SCOPE] : [...BASE_SCOPES];
}

function missingScopes(requested: readonly string[], granted: readonly string[]): string[] {
	const have = new Set(granted);
	return requested.filter((scope) => !have.has(scope));
}

/**
 * The consent screen lets the user untick optional scopes, so what was granted can be less than
 * what was asked for. Fail before touching anything, and say how to ask again.
 */
export function assertScopesGranted(
	requested: readonly string[],
	granted: readonly string[]
): void {
	const missing = missingScopes(requested, granted);
	if (missing.length === 0) return;
	throw new SetupError(
		ERROR_CODES.scopesMissing,
		`The sign-in did not grant: ${missing.join(', ')}`,
		{
			hint: 'Nothing was changed. Run `npm run setup -- --force` and leave every permission ticked.'
		}
	);
}
