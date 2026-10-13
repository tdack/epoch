/** The upstream repository, offered when an install names no source of its own. */
const UPSTREAM_SOURCE_URL = 'https://github.com/tdack/epoch';

/**
 * Where this install's source code can be had, for the link AGPL section 13 asks for.
 *
 * A fork that changes Epoch sets `EPOCH_SOURCE_URL` to its own repository, because the licence asks
 * it to offer the source it actually runs, not ours.
 */
export function sourceUrl(env: { EPOCH_SOURCE_URL?: string } | undefined): string {
	// `||` rather than `??`: a var left blank must still give visitors a working link.
	return env?.EPOCH_SOURCE_URL?.trim() || UPSTREAM_SOURCE_URL;
}
