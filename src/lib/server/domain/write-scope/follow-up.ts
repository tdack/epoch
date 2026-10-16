import type { TreeRows } from '../change-log';
import { mergeSeeds, seedOf, type ScopeSeed } from '../write-scope';

/**
 * What a command that opted in (`shouldFollowFamily`) still needs after its first load (ADR-055).
 *
 * The labeller numbers a partnership among the same pair's other partnerships ("2nd partnership of
 * A and B"). A seed that names a partnership, or a child, loads the partners but not their other
 * partnerships, and the command cannot name them: they are found only in the first snapshot. So the
 * second seed adds, as people, every partner of every partnership loaded and the parents of each
 * seeded child; the closure then brings their partnerships, and with them the twins.
 *
 * Null when that adds nobody the first seed did not already name, so a request with nothing to
 * follow stays at one load. It returns only the extra records, so the equivalence harness can apply
 * it with `selectScope(whole, mergeSeeds(seed, followUpSeed(selectScope(whole, seed), seed)))`.
 */
export function followUpSeed(rows: TreeRows, seed: ScopeSeed): ScopeSeed | null {
	if (!seed.shouldFollowFamily) return null;
	const extra = new Set<string>();
	for (const partner of rows.unionPartners) extra.add(partner.personId);
	for (const link of rows.parentChild) if (seed.people.has(link.childId)) extra.add(link.parentId);
	for (const id of seed.people) extra.delete(id);
	return extra.size > 0 ? seedOf({ people: extra }) : null;
}

/** What the second load should read instead of a scoped snapshot: every row. */
export const FOLLOW_UP_WHOLE = 'whole' as const;

/**
 * The second load: a merged seed, `FOLLOW_UP_WHOLE`, or null when the first snapshot already holds
 * everything. A partnership the seed names that has no partners is whole-tree, because a restricted
 * viewer's mask hides such a partnership only when the snapshot holds a private person, and a
 * scoped snapshot of it holds nobody; only the whole tree answers as it always did. Rare, so the
 * cost does not matter.
 */
export function seedWithFollowUp(
	rows: TreeRows,
	seed: ScopeSeed
): ScopeSeed | typeof FOLLOW_UP_WHOLE | null {
	if (!seed.shouldFollowFamily) return null;
	const partnered = new Set(rows.unionPartners.map((p) => p.unionId));
	if (rows.unions.some((u) => seed.unions.has(u.id) && !partnered.has(u.id)))
		return FOLLOW_UP_WHOLE;
	const extra = followUpSeed(rows, seed);
	return extra ? mergeSeeds(seed, extra) : null;
}
