import type { D1Database } from '@cloudflare/workers-types';
import { getDb } from '../db';
import { InstallRepository, type StoredAccessConfig } from '../repositories/install-repository';

/** The Access team domain and audience a token is checked against; either may be empty. */
export interface AccessConfig {
	teamDomain: string;
	aud: string;
}

// Only a found row is kept: caching "none yet" would leave this isolate refusing every sign-in
// after `/setup` finished, until it was recycled.
let storedConfig: StoredAccessConfig | null = null;

/**
 * The Worker's own vars, or, where they are missing, what `/setup` stored in D1 (ADR-082). The vars
 * win, so an install made by `./setup` never reads D1 here. An empty result still fails closed in
 * `validateAccessJwt`.
 */
export async function resolveAccessConfig(
	vars: Partial<AccessConfig>,
	d1: D1Database | undefined
): Promise<AccessConfig> {
	if (vars.teamDomain && vars.aud) return { teamDomain: vars.teamDomain, aud: vars.aud };
	if (!storedConfig && d1) storedConfig = await new InstallRepository(getDb(d1)).findAccessConfig();
	return {
		teamDomain: vars.teamDomain || storedConfig?.teamDomain || '',
		aud: vars.aud || storedConfig?.aud || ''
	};
}

/** Forgets the cached row; for tests only. */
export function resetAccessConfigCache(): void {
	storedConfig = null;
}
