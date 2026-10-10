import { ERROR_CODES, SetupError } from './errors.ts';

/**
 * The R2 lifecycle rule that expires exports. Read-merge-write, because the R2 API replaces the
 * whole rule set: this tool must keep whatever rules an owner added in the dashboard and only own
 * the one scoped to `exports/`.
 */

/** Every export object lives under this prefix; the lifecycle rule that expires them is scoped to it. */
export const EXPORT_LIFECYCLE_PREFIX = 'exports/';

/** The identifier our rule carries, so a later run replaces it rather than adding a second. */
const EXPORT_LIFECYCLE_RULE_ID = 'epoch-export-expiry';

/** One day, matching the export read-time expiry: after this the lifecycle rule may remove a file. */
export const EXPORT_RULE_MAX_AGE_SECONDS = 86400;

/** Prefixes this tool refuses to add a destructive rule beside: they hold live media and import staging. */
const RESERVED_PREFIXES = ['media/', 'staging/'];

/**
 * One R2 lifecycle rule, as much of it as this tool reads or writes. Unknown fields are allowed on
 * purpose: an unrelated rule is carried through untouched by the read-merge-write.
 */
export interface R2LifecycleRule {
	id?: string;
	conditions?: { prefix?: string };
	// The R2 API's own field name; renaming it would stop it round-tripping through the API.
	// eslint-disable-next-line @typescript-eslint/naming-convention
	enabled?: boolean;
	abortMultipartUploadsTransition?: { condition?: { type?: string; maxAge?: number } };
	deleteObjectsTransition?: { condition?: { type?: string; maxAge?: number; date?: string } };
	storageClassTransitions?: unknown[];
	[key: string]: unknown;
}

/** The rule this tool writes: expire everything under `exports/` after a day. */
export function exportLifecycleRule(): R2LifecycleRule {
	return {
		id: EXPORT_LIFECYCLE_RULE_ID,
		enabled: true,
		conditions: { prefix: EXPORT_LIFECYCLE_PREFIX },
		deleteObjectsTransition: {
			condition: { type: 'Age', maxAge: EXPORT_RULE_MAX_AGE_SECONDS }
		}
	};
}

/**
 * Whether a rule is the export rule and nothing more: scoped to exactly `exports/`, in effect, and
 * expiring objects no later than `maxAgeSeconds`. A rule that expires the whole bucket, or a wider
 * prefix, is not this one.
 */
export function isExportOnlyRule(
	rule: R2LifecycleRule,
	maxAgeSeconds = EXPORT_RULE_MAX_AGE_SECONDS
): boolean {
	if (rule.conditions?.prefix !== EXPORT_LIFECYCLE_PREFIX) return false;
	if (rule.enabled === false) return false;
	const condition = rule.deleteObjectsTransition?.condition;
	if (!condition || condition.type !== 'Age') return false;
	return typeof condition.maxAge === 'number' && condition.maxAge <= maxAgeSeconds;
}

/**
 * Read-merge-write: keep every unrelated rule, and replace any existing export rule with ours.
 *
 * Refuses to run beside a destructive rule — one that deletes or transitions objects — with no
 * prefix (it would expire the whole bucket) or one overlapping `media/`/`staging/`, which hold live
 * files. This tool must not be the reason a family photo or a staged import disappears.
 *
 * @param existing - The rules the bucket already has (empty when it has none).
 * @returns The rules to write: the unrelated ones, then ours.
 * @throws SetupError - If a destructive rule with no prefix, or one covering `media/`/`staging/`, already exists.
 */
export function mergeExportRule(existing: R2LifecycleRule[]): R2LifecycleRule[] {
	for (const rule of existing) assertSafeToCoexist(rule);
	const others = existing.filter((rule) => rule.conditions?.prefix !== EXPORT_LIFECYCLE_PREFIX);
	return [...others, exportLifecycleRule()];
}

/**
 * Whether a rule deletes or transitions objects, and so can destroy data. A rule that only aborts
 * stale multipart uploads is harmless — Cloudflare adds one to every new bucket — so it is ignored.
 */
export function isDangerousRule(rule: R2LifecycleRule): boolean {
	if (rule.enabled === false) return false;
	if (rule.deleteObjectsTransition !== undefined) return true;
	return Array.isArray(rule.storageClassTransitions) && rule.storageClassTransitions.length > 0;
}

/**
 * The first protected prefix a rule's prefix overlaps, or null. Prefixes are plain strings, so two
 * overlap when either starts with the other: `m`, `med` and `media/` all reach into `media/`.
 */
export function overlapsReservedPrefix(prefix: string): string | null {
	return (
		RESERVED_PREFIXES.find(
			(protectedPrefix) => protectedPrefix.startsWith(prefix) || prefix.startsWith(protectedPrefix)
		) ?? null
	);
}

/**
 * Why a destructive rule would put live media or staging objects at risk, or null when it is safe.
 * An abort-only rule and any rule that neither deletes nor transitions objects return null.
 */
export function reservedRisk(rule: R2LifecycleRule): string | null {
	if (!isDangerousRule(rule)) return null;
	const prefix = rule.conditions?.prefix ?? '';
	if (prefix.trim() === '') {
		return 'it has no prefix, so it would expire every object in the bucket';
	}
	const reserved = overlapsReservedPrefix(prefix);
	if (reserved) return `it is scoped to "${prefix}", which overlaps the live "${reserved}" prefix`;
	return null;
}

function assertSafeToCoexist(rule: R2LifecycleRule): void {
	const risk = reservedRisk(rule);
	if (!risk) return;
	throw new SetupError(ERROR_CODES.command, `An R2 lifecycle rule is unsafe: ${risk}`, {
		hint: 'Scope or remove that rule before running setup.'
	});
}
