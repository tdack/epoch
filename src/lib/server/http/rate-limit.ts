import { RateLimitedError } from '../domain/errors';

/**
 * Per-endpoint limits (ADR-066). The numbers Cloudflare enforces are in `wrangler.jsonc` under
 * `ratelimits` (a binding cannot read its own limit), so `rate-limit.test.ts` fails if the two
 * disagree. They sit far above real use and only stop a loop or a flood:
 * - uploads: 60 a minute is a folder of photos dropped on one record, and the client sends them one
 *   at a time; a person cannot add 60 files by hand in a minute.
 * - imports: 10 a minute covers a preview and an import for a few trees; each one parses a file of
 *   up to the import cap, so it is the costly path.
 * - CSP reports: 60 a minute per address is a page load that trips several directives, many times.
 * - public tree reads: 600 a minute per address is ten requests a second, far past a person
 *   browsing the public tree, whose every page load costs several D1 reads.
 */
export const UPLOAD_RATE_LIMIT_PER_MINUTE = 60;
export const IMPORT_RATE_LIMIT_PER_MINUTE = 10;
export const CSP_REPORT_RATE_LIMIT_PER_MINUTE = 60;
export const PUBLIC_READ_RATE_LIMIT_PER_MINUTE = 600;

/** The window every binding uses; Workers Rate Limiting allows only 10 or 60 seconds. */
export const RATE_LIMIT_PERIOD_SECONDS = 60;

const warnedMissing = new Set<string>();

interface RateLimitCheck {
	/** The binding from the platform env; undefined when the deployment has none. */
	binding: RateLimit | undefined;
	/** Names the binding in the one-time log line. */
	bindingName: string;
	/** Who is being counted: a user id, or an address for anonymous callers. */
	key: string;
	/** The 429's message, in words a person can act on. */
	message: string;
}

/**
 * Throws `RateLimitedError` when the caller is over the limit. Call it before reading the body, so a
 * refused request costs no parsing. A missing binding (tests, a preview without one) allows the
 * request and logs once per binding: refusing would make the endpoint unusable where it is not set up.
 *
 * The count is per Cloudflare location and eventually consistent, so it bounds abuse rather than
 * counting exactly.
 */
export async function enforceRateLimit(check: RateLimitCheck): Promise<void> {
	if (!check.binding) {
		if (!warnedMissing.has(check.bindingName)) {
			warnedMissing.add(check.bindingName);
			console.warn(`Rate limit binding ${check.bindingName} is missing; requests are not limited`);
		}
		return;
	}
	const outcome = await check.binding.limit({ key: check.key });
	if (!outcome.success) throw new RateLimitedError(check.message, RATE_LIMIT_PERIOD_SECONDS);
}

/** Clears the once-per-binding log memory. For tests. */
export function resetRateLimitWarnings(): void {
	warnedMissing.clear();
}
