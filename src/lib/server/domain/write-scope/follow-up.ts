import type { TreeRows } from '../change-log';
import { mergeSeeds, seedOf, type ScopeSeed } from '../write-scope';

/** Loads a write may make before it gives up and reads the whole tree. */
export const MAX_FOLLOW_UP_LOADS = 3;

/**
 * Family rule, for a command that opted in (`shouldFollowFamily`).
 *
 * The labeller numbers a partnership among the same pair's other partnerships ("2nd partnership of
 * A and B"). A seed that names a partnership, or a child, loads the partners but not their other
 * partnerships, and the command cannot name them: they are found only in the first snapshot. So the
 * second seed adds, as people, every partner of every partnership loaded and the parents of each
 * seeded child; the closure then brings their partnerships, and with them the twins.
 *
 * First round only: applied again it would add the partners of those partners and walk the whole
 * connected family.
 */
function familyExtra(rows: TreeRows, seed: ScopeSeed): ScopeSeed | null {
	if (!seed.shouldFollowFamily) return null;
	const extra = new Set<string>();
	for (const partner of rows.unionPartners) extra.add(partner.personId);
	for (const link of rows.parentChild) if (seed.people.has(link.childId)) extra.add(link.parentId);
	for (const id of seed.people) extra.delete(id);
	return extra.size > 0 ? seedOf({ people: extra }) : null;
}

/**
 * Evidence rule, for a command that opted in (`shouldFollowEvidence`).
 *
 * To a restricted viewer a note, a task, a source and a repository exist only through the records
 * they sit on (ADR-028, ADR-029), and the closure resolves a note attachment or a task to its
 * subject without pulling that subject's other records. So what the command is about is found in
 * the snapshot and seeded directly, and seeding is what brings the rest:
 *
 * - the source an attachment or a task is on or about: a seeded source brings every citation of it,
 *   and with them the subjects that decide whether it is visible;
 * - the repository an attachment is on: a seeded repository brings its links, which name the
 *   sources that decide whether it is visible;
 * - the sources a seeded repository, or a seeded link, names;
 * - the note a task is about: a seeded note brings every attachment, and so every use that decides
 *   whether it is visible.
 *
 * It reads only what the seed anchors (its attachments, the attachments of its notes, its tasks,
 * repositories and links), never everything loaded, because a person cited by a popular source
 * would otherwise seed that source and pull a share of the tree. Only ids not already seeded count,
 * so a round with nothing new ends the chain. A chain can run several rounds: task, note,
 * repository, link, source.
 */
function evidenceExtra(rows: TreeRows, seed: ScopeSeed): ScopeSeed | null {
	if (!seed.shouldFollowEvidence) return null;
	const sources = new Set<string>();
	const repositories = new Set<string>();
	const notes = new Set<string>();
	for (const a of rows.noteAttachments) {
		const isAnchored =
			seed.noteAttachments.has(a.id) || (a.noteId !== null && seed.notes.has(a.noteId));
		if (!isAnchored) continue;
		if (a.subjectKind === 'source') sources.add(a.subjectId);
		if (a.subjectKind === 'repository') repositories.add(a.subjectId);
	}
	for (const t of rows.researchTasks) {
		if (!seed.tasks.has(t.id) || !t.subjectId) continue;
		if (t.subjectKind === 'source') sources.add(t.subjectId);
		if (t.subjectKind === 'note') notes.add(t.subjectId);
	}
	for (const l of rows.sourceRepositories) {
		if (
			seed.sourceRepositories.has(l.id) ||
			(l.repositoryId && seed.repositories.has(l.repositoryId))
		)
			sources.add(l.sourceId);
	}
	for (const id of seed.sources) sources.delete(id);
	for (const id of seed.repositories) repositories.delete(id);
	for (const id of seed.notes) notes.delete(id);
	return sources.size + repositories.size + notes.size > 0
		? seedOf({ sources, repositories, notes })
		: null;
}

/**
 * The extra records the next load needs, as a seed of their own, so the equivalence harness can
 * apply it with `selectScope(whole, mergeSeeds(seed, followUpSeed(selectScope(whole, seed), seed)))`.
 * `loads` is how many loads have been made, the family rule runs after the first only.
 */
export function followUpSeed(rows: TreeRows, seed: ScopeSeed, loads = 1): ScopeSeed | null {
	const family = loads === 1 ? familyExtra(rows, seed) : null;
	const evidence = evidenceExtra(rows, seed);
	if (family && evidence) return mergeSeeds(family, evidence);
	return family ?? evidence;
}

/** What the next load should read instead of a scoped snapshot: every row. */
export const FOLLOW_UP_WHOLE = 'whole' as const;

/**
 * The next load: a merged seed, `FOLLOW_UP_WHOLE`, or null when the snapshot already holds
 * everything. A partnership the seed names that has no partners is whole-tree, because a restricted
 * viewer's mask hides such a partnership only when the snapshot holds a private person, and a
 * scoped snapshot of it holds nobody; only the whole tree answers as it always did. A chain that
 * still has something to follow after `MAX_FOLLOW_UP_LOADS` is whole-tree as well. Both are rare,
 * so the cost does not matter.
 */
export function seedWithFollowUp(
	rows: TreeRows,
	seed: ScopeSeed,
	loads = 1
): ScopeSeed | typeof FOLLOW_UP_WHOLE | null {
	if (!seed.shouldFollowFamily && !seed.shouldFollowEvidence) return null;
	if (loads === 1) {
		const partnered = new Set(rows.unionPartners.map((p) => p.unionId));
		if (rows.unions.some((u) => seed.unions.has(u.id) && !partnered.has(u.id)))
			return FOLLOW_UP_WHOLE;
	}
	const extra = followUpSeed(rows, seed, loads);
	if (!extra) return null;
	return loads >= MAX_FOLLOW_UP_LOADS ? FOLLOW_UP_WHOLE : mergeSeeds(seed, extra);
}
