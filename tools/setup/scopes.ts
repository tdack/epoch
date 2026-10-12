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
	'email-sending.read',
	'tag.read',
	'tag.write',
	'workers-ci.write'
] as const;

/**
 * Asked for, but not required: resource tags only add a second witness beside the markers, so a
 * profile signed in before these existed must keep working and degrade to markers alone.
 */
export const TAG_SCOPES = ['tag.read', 'tag.write'] as const;

/**
 * Workers Builds' variables and triggers (ADR-043). SPIKE: that `workers-ci` is the scope family the
 * Builds API checks (cf also lists the legacy `workers_builds:write`). Optional like the tag scopes:
 * without it setup prints the build variable to paste into the dashboard instead of setting it.
 */
export const BUILDS_SCOPES = ['workers-ci.write'] as const;

const OPTIONAL_SCOPES: readonly string[] = [...TAG_SCOPES, ...BUILDS_SCOPES];

/** Broad, so asked for only when the user chose a minted deploy token. */
const EPHEMERAL_SCOPE = 'account_api_tokens:create';

export function requestedScopes(mode: AuthMode): string[] {
	return mode === AUTH_MODES.ephemeral ? [...BASE_SCOPES, EPHEMERAL_SCOPE] : [...BASE_SCOPES];
}

/** What a sign-in must have granted; the optional scopes are left out because their steps degrade. */
export function requiredScopes(mode: AuthMode): string[] {
	return requestedScopes(mode).filter((scope) => !OPTIONAL_SCOPES.includes(scope));
}

export function missingTagScopes(granted: readonly string[]): string[] {
	return missingScopes(TAG_SCOPES, granted);
}

export function missingBuildsScopes(granted: readonly string[]): string[] {
	return missingScopes(BUILDS_SCOPES, granted);
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
			hint: 'Nothing was changed. Run `./setup --force` and leave every permission ticked.'
		}
	);
}
