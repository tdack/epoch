import { STAGED_IMPORT_MAX_AGE_MS } from '../../src/lib/server/gedcom/limits.ts';
import { ERROR_CODES, SetupError } from './errors.ts';

/**
 * The R2 lifecycle rules this tool owns: one expiring `exports/`, one expiring `staging/`.
 * Read-merge-write, because the R2 API replaces the whole rule set: this tool must keep whatever
 * rules an owner added in the dashboard and only own the two scoped to those prefixes.
 */

/** Every export object lives under this prefix; the lifecycle rule that expires them is scoped to it. */
export const EXPORT_LIFECYCLE_PREFIX = 'exports/';

/** The identifier our rule carries, so a later run replaces it rather than adding a second. */
const EXPORT_LIFECYCLE_RULE_ID = 'epoch-export-expiry';

/** One day, matching the export read-time expiry: after this the lifecycle rule may remove a file. */
export const EXPORT_RULE_MAX_AGE_SECONDS = 86400;

/** Staged GEDCOM imports live under this prefix (`stagingPrefix` in gedcom-service.ts). */
export const STAGING_LIFECYCLE_PREFIX = 'staging/';

/** The identifier of our staging rule; it is the only destructive rule allowed over `staging/`. */
const STAGING_LIFECYCLE_RULE_ID = 'epoch-staging-expiry';

/** Resumable uploads (ADR-074) stage their parts under this prefix, inside `staging/`. */
export const UPLOAD_LIFECYCLE_PREFIX = 'staging/uploads/';

/** The identifier of our abort rule; it only aborts incomplete multipart uploads, deleting nothing. */
const UPLOAD_ABORT_RULE_ID = 'epoch-upload-abort';

/**
 * One day, the upload session lifetime. A session past its expiry is closed by the sweep; this rule
 * drops the R2 parts the sweep could not abort. It is set to the lifetime, not longer, so it never
 * aborts a session that is still open.
 */
export const UPLOAD_ABORT_MAX_AGE_SECONDS = 24 * 60 * 60;

/**
 * Seven days. The app stops counting a staged object after `STAGED_IMPORT_MAX_AGE_MS` (four days,
 * the queue's default message retention, so no live message outlives it), and the consumer sets no
 * retry delay, so a queued import never reads its object later than that. The extra three days
 * cover clock skew and a delayed redeploy; the rule is garbage collection for a crashed consumer,
 * never the control.
 */
export const STAGING_RULE_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

/** The shortest age the staging rule may have: anything at or under the app's cap could delete a live import. */
const STAGING_RULE_MIN_AGE_SECONDS = STAGED_IMPORT_MAX_AGE_MS / 1000;

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

/** The rule this tool writes: expire stranded staged imports after a week. */
export function stagingLifecycleRule(): R2LifecycleRule {
	return {
		id: STAGING_LIFECYCLE_RULE_ID,
		enabled: true,
		conditions: { prefix: STAGING_LIFECYCLE_PREFIX },
		deleteObjectsTransition: {
			condition: { type: 'Age', maxAge: STAGING_RULE_MAX_AGE_SECONDS }
		}
	};
}

/** The rule this tool writes: abort incomplete multipart uploads under `staging/uploads/` after a day. */
export function uploadAbortLifecycleRule(): R2LifecycleRule {
	return {
		id: UPLOAD_ABORT_RULE_ID,
		enabled: true,
		conditions: { prefix: UPLOAD_LIFECYCLE_PREFIX },
		abortMultipartUploadsTransition: {
			condition: { type: 'Age', maxAge: UPLOAD_ABORT_MAX_AGE_SECONDS }
		}
	};
}

/**
 * Whether a rule is our staging rule: our id, exactly `staging/`, in effect, and a plain age-based
 * delete no sooner than the app's cap. Recognised by id and prefix together so a foreign rule over
 * `staging/` never passes, and by age so a hand-shortened copy is flagged rather than trusted.
 */
export function isOwnStagingRule(rule: R2LifecycleRule): boolean {
	if (rule.id !== STAGING_LIFECYCLE_RULE_ID) return false;
	if (rule.conditions?.prefix !== STAGING_LIFECYCLE_PREFIX) return false;
	if (rule.enabled === false) return false;
	if (Array.isArray(rule.storageClassTransitions) && rule.storageClassTransitions.length > 0) {
		return false;
	}
	const condition = rule.deleteObjectsTransition?.condition;
	if (!condition || condition.type !== 'Age') return false;
	return typeof condition.maxAge === 'number' && condition.maxAge > STAGING_RULE_MIN_AGE_SECONDS;
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
 * Read-merge-write: keep every unrelated rule, and replace any existing export, staging or upload
 * abort rule with ours.
 *
 * Refuses to run beside a destructive rule — one that deletes or transitions objects — with no
 * prefix (it would expire the whole bucket) or one overlapping `media/`/`staging/`, which hold live
 * files. Only our own staging rule (see `isOwnStagingRule`) is exempt. A stale copy of it, say one
 * an owner shortened, is replaced rather than refused. This tool must not be the reason a family
 * photo or a staged import disappears.
 *
 * @param existing - The rules the bucket already has (empty when it has none).
 * @returns The rules to write: the unrelated ones, then ours.
 * @throws SetupError - If a destructive rule with no prefix, or one covering `media/`/`staging/`, already exists.
 */
export function mergeLifecycleRules(existing: R2LifecycleRule[]): R2LifecycleRule[] {
	const others = existing.filter((rule) => !isOwnRuleSlot(rule));
	for (const rule of others) assertSafeToCoexist(rule);
	return [
		...others.filter((rule) => rule.conditions?.prefix !== EXPORT_LIFECYCLE_PREFIX),
		exportLifecycleRule(),
		stagingLifecycleRule(),
		uploadAbortLifecycleRule()
	];
}

/**
 * Our rule's id on its own prefix, whatever its age: the slot we overwrite, not a foreign rule.
 * Matched by id and prefix together, so an owner's rule that reuses one of our ids is kept.
 */
function isOwnRuleSlot(rule: R2LifecycleRule): boolean {
	return (
		(rule.id === STAGING_LIFECYCLE_RULE_ID &&
			rule.conditions?.prefix === STAGING_LIFECYCLE_PREFIX) ||
		(rule.id === UPLOAD_ABORT_RULE_ID && rule.conditions?.prefix === UPLOAD_LIFECYCLE_PREFIX)
	);
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
	if (isOwnStagingRule(rule)) return null;
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
