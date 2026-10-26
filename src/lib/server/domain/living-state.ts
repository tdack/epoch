/**
 * Whether a person is likely living, or died too recently to show, from their own facts (ADR-015,
 * amended 2026-10-26). Pure, so the rule and its
 * edge cases are tested without a database; `repositories/visibility.ts` writes the same rule as
 * SQL, and a test holds the two to the same answers.
 */

import type { PersonPrivacy } from '../../shared/privacy';

export type { PersonPrivacy };

const DEFAULT_MAX_ALIVE_YEARS = 120;

/** Any of these, dated or not, means the person has died. */
export const DEATH_EVENT_TYPES = ['DEAT', 'BURI', 'CREM'] as const;

export const PERSON_PRIVACY = {
	AUTO: 'auto',
	PUBLIC: 'public',
	PRIVATE: 'private'
} as const satisfies Record<string, PersonPrivacy>;

export interface LivingFact {
	type: string;
	/** The stored inclusive lower bound (`YYYY-MM-DD`), null when unbounded or undated. */
	dateSort: string | null;
	/** The stored inclusive upper bound (`YYYY-MM-DD`), null when unbounded or undated. */
	dateSortEnd: string | null;
}

function yearsBefore(now: Date, years: number): string {
	const year = now.getUTCFullYear() - years;
	const month = String(now.getUTCMonth() + 1).padStart(2, '0');
	const day = String(now.getUTCDate()).padStart(2, '0');
	return `${String(year).padStart(4, '0')}-${month}-${day}`;
}

/**
 * The tree's living rule as one string: the day before which a fact must have ended for the person
 * to count as not living, then, when the tree keeps the recently dead private, `/` and the day a
 * death must have ended before to be shown. One string in the existing slot, as with
 * `EVERYONE_SHOWN_CUTOFF`, so the readers that only thread the cutoff need no change; `cutoffParts`
 * is the one reader of the format. The caller supplies `now`; SQL never reads the clock, or tests
 * could not be deterministic.
 */
export function livingCutoff(
	now: Date,
	maxAliveYears: number = DEFAULT_MAX_ALIVE_YEARS,
	recentDeathYears = 0
): string {
	const living = yearsBefore(now, maxAliveYears);
	return recentDeathYears > 0 ? `${living}/${yearsBefore(now, recentDeathYears)}` : living;
}

/**
 * The day before which any fact decides the rule, for a read that loads only some fact types and
 * must add back those that make a person old; undefined on the public tree, where none decides.
 */
export function oldFactsBefore(cutoff: string): string | undefined {
	return cutoff === EVERYONE_SHOWN_CUTOFF ? undefined : cutoffParts(cutoff).livedBefore;
}

/** The days a cutoff holds; `diedBefore` is null when the recently dead are shown. */
export function cutoffParts(cutoff: string): { livedBefore: string; diedBefore: string | null } {
	const [livedBefore, diedBefore] = cutoff.split('/');
	return { livedBefore: livedBefore!, diedBefore: diedBefore ?? null };
}

/**
 * A cutoff that means "nobody counts as living" (ADR-041), so on the public tree only an explicit
 * `private` override hides anyone. A sentinel in the existing `cutoff` slot rather than a new
 * flag, so every reader that already threads the cutoff (the pure rule, the SQL predicate, the
 * masks, the focus window) changes with one definition. It sorts after every date.
 */
export const EVERYONE_SHOWN_CUTOFF = '~';

const isDeath = (type: string) => (DEATH_EVENT_TYPES as readonly string[]).includes(type);

/**
 * True unless the facts show the person has died, was born before the cutoff, or has any other fact
 * that ended before it (a census that long ago means they cannot still be alive, as webtrees'
 * `isDead()` also reads it). A marriage is the partnership's fact, not theirs, so it is not read. A fact with no upper bound (`AFT 1900`, undated) proves
 * nothing, so it keeps the person living: the rule errs toward private, never toward showing
 * someone who might be alive. Relatives' dates are not read; that needs the stored inputs ADR-015
 * names, and the `probably_dead_no_death` quality rule points a manager at those people instead.
 */
export function isLikelyLiving(facts: readonly LivingFact[], cutoff: string): boolean {
	if (cutoff === EVERYONE_SHOWN_CUTOFF) return false;
	if (facts.some((f) => isDeath(f.type))) return false;
	const { livedBefore } = cutoffParts(cutoff);
	// A birth counts like any fact, so one old birth among conflicting ones is enough: the SQL twin
	// cannot afford a separate birth lookup under D1's expression-depth cap (ADR-015).
	return !facts.some((f) => f.dateSortEnd !== null && f.dateSortEnd < livedBefore);
}

/**
 * True when the tree keeps the recently dead private and a death, burial or cremation may have
 * ended on or after that day. An undated one is taken as long ago, or every `DEAT Y` would hide an
 * ancestor; a dated one with no upper bound (`AFT 2010`) may be recent, so it counts.
 */
export function isRecentlyDead(facts: readonly LivingFact[], cutoff: string): boolean {
	if (cutoff === EVERYONE_SHOWN_CUTOFF) return false;
	const { diedBefore } = cutoffParts(cutoff);
	if (diedBefore === null) return false;
	return facts.some(
		(f) =>
			isDeath(f.type) &&
			(f.dateSortEnd !== null ? f.dateSortEnd >= diedBefore : f.dateSort !== null)
	);
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
	return isLikelyLiving(facts, cutoff) || isRecentlyDead(facts, cutoff);
}
