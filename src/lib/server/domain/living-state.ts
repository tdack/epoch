/**
 * Whether a person is likely living, from their own facts (ADR-015). Pure, so the rule and its
 * edge cases are tested without a database; `repositories/visibility.ts` writes the same rule as
 * SQL, and a test holds the two to the same answers.
 */

import type { PersonPrivacy } from '../../shared/privacy';

export type { PersonPrivacy };

export const DEFAULT_MAX_ALIVE_YEARS = 120;

/** Any of these, dated or not, means the person has died. */
export const DEATH_EVENT_TYPES = ['DEAT', 'BURI', 'CREM'] as const;
/** The facts that say when someone was born; the latest upper bound among them is used. */
export const BIRTH_EVENT_TYPES = ['BIRT', 'CHR', 'BAPM'] as const;

export const PERSON_PRIVACY = {
	AUTO: 'auto',
	PUBLIC: 'public',
	PRIVATE: 'private'
} as const satisfies Record<string, PersonPrivacy>;

export interface LivingFact {
	type: string;
	/** The stored inclusive upper bound (`YYYY-MM-DD`), null when unbounded or undated. */
	dateSortEnd: string | null;
}

/**
 * The day before which a birth must have ended for the person to count as not living. The caller
 * supplies `now`; SQL never reads the clock, or tests could not be deterministic.
 */
export function livingCutoff(now: Date, maxAliveYears: number = DEFAULT_MAX_ALIVE_YEARS): string {
	const year = now.getUTCFullYear() - maxAliveYears;
	const month = String(now.getUTCMonth() + 1).padStart(2, '0');
	const day = String(now.getUTCDate()).padStart(2, '0');
	return `${String(year).padStart(4, '0')}-${month}-${day}`;
}

const isDeath = (type: string) => (DEATH_EVENT_TYPES as readonly string[]).includes(type);
const isBirth = (type: string) => (BIRTH_EVENT_TYPES as readonly string[]).includes(type);

/**
 * True unless the facts show the person has died or was born before the cutoff. A birth with no
 * upper bound (`AFT 1900`, an undated `BIRT`) is unbounded and so keeps the person living: the
 * rule errs toward private, never toward showing someone who might be alive.
 */
export function isLikelyLiving(facts: readonly LivingFact[], cutoff: string): boolean {
	if (facts.some((f) => isDeath(f.type))) return false;
	const births = facts.filter((f) => isBirth(f.type));
	if (births.length === 0) return true;
	// The latest bound wins: two conflicting births must both be old for the person to be old.
	const latest = births.reduce((max, f) => {
		const end = f.dateSortEnd ?? '9999-12-31';
		return end > max ? end : max;
	}, '');
	return !(latest < cutoff);
}

/**
 * An override always wins; `auto` follows the derivation, except that the viewer's own creations
 * are shown: `isOwn` is true when the viewer is a contributor who created this person. A manager's
 * `private` still hides them.
 */
export function isPersonPrivate(
	privacy: PersonPrivacy,
	facts: readonly LivingFact[],
	cutoff: string,
	isOwn = false
): boolean {
	if (privacy === PERSON_PRIVACY.PRIVATE) return true;
	if (privacy === PERSON_PRIVACY.PUBLIC) return false;
	if (isOwn) return false;
	return isLikelyLiving(facts, cutoff);
}
