/**
 * The rows an undo reads (ADR-055). Undo needs the tree only for two things: naming the records it
 * writes (`makeLabeler`) and finding rows that point at a row it deletes (`dependentsOfDeletions`).
 * Both look at the records the ops name and at what is attached to or points at them, which is what
 * the scope closure loads, so the seed is just every record in the ops.
 */

import { dependentsOfDeletions, type RowOp, type TreeRows } from './change-log';
import { SUBJECT, mergeSeeds, seedOf, type ScopeSeed } from './write-scope';

/** Both images of every op, so a row an undo deletes and a row it creates are each reached. */
export function undoSeed(ops: readonly RowOp[]): ScopeSeed {
	const ids = {
		people: [] as Array<string | null>,
		unions: [] as Array<string | null>,
		events: [] as Array<string | null>,
		names: [] as Array<string | null>,
		links: [] as Array<string | null>,
		media: [] as Array<string | null>,
		citations: [] as Array<string | null>,
		sources: [] as Array<string | null>,
		repositories: [] as Array<string | null>,
		notes: [] as Array<string | null>,
		noteAttachments: [] as string[],
		tasks: [] as string[],
		subtrees: [] as string[]
	};
	/** What a subject column names. An image may be of a row that is not in the tree yet. */
	const buckets: Record<string, Array<string | null>> = {
		[SUBJECT.PERSON]: ids.people,
		[SUBJECT.UNION]: ids.unions,
		[SUBJECT.EVENT]: ids.events,
		[SUBJECT.NAME]: ids.names,
		[SUBJECT.LINK]: ids.links,
		[SUBJECT.SOURCE]: ids.sources,
		[SUBJECT.CITATION]: ids.citations,
		[SUBJECT.REPOSITORY]: ids.repositories,
		[SUBJECT.NOTE]: ids.notes
	};
	const addSubject = (kind: string | null, id: string | null) => {
		if (kind) buckets[kind]?.push(id);
	};
	for (const op of ops) {
		switch (op.table) {
			case 'individuals':
				ids.people.push(op.id);
				break;
			case 'unions':
				ids.unions.push(op.id);
				break;
			case 'person_names':
				ids.names.push(op.id);
				for (const image of [op.before, op.after]) ids.people.push(image?.personId ?? null);
				break;
			case 'union_partners':
				for (const image of [op.before, op.after]) {
					ids.unions.push(image?.unionId ?? null);
					ids.people.push(image?.personId ?? null);
				}
				break;
			case 'parent_child':
				ids.links.push(op.id);
				for (const image of [op.before, op.after]) {
					ids.people.push(image?.parentId ?? null, image?.childId ?? null);
					ids.unions.push(image?.unionId ?? null);
				}
				break;
			case 'events':
				ids.events.push(op.id);
				for (const image of [op.before, op.after])
					addSubject(
						image?.entityType === 'FAMILY' ? SUBJECT.UNION : SUBJECT.PERSON,
						image?.entityId ?? null
					);
				break;
			case 'media_items':
				ids.media.push(op.id);
				break;
			case 'media_links':
				for (const image of [op.before, op.after]) {
					ids.media.push(image?.mediaId ?? null);
					ids.people.push(image?.entityId ?? null);
					ids.unions.push(image?.entityId ?? null);
					ids.sources.push(image?.entityId ?? null);
				}
				break;
			case 'sources':
				ids.sources.push(op.id);
				break;
			case 'repositories':
				ids.repositories.push(op.id);
				break;
			case 'source_repositories':
				for (const image of [op.before, op.after]) {
					ids.sources.push(image?.sourceId ?? null);
					ids.repositories.push(image?.repositoryId ?? null);
				}
				break;
			case 'citations':
				ids.citations.push(op.id);
				for (const image of [op.before, op.after]) {
					addSubject(image?.subjectKind ?? null, image?.subjectId ?? null);
					ids.sources.push(image?.sourceId ?? null);
				}
				break;
			case 'notes':
				ids.notes.push(op.id);
				break;
			case 'note_attachments':
				ids.noteAttachments.push(op.id);
				for (const image of [op.before, op.after]) {
					addSubject(image?.subjectKind ?? null, image?.subjectId ?? null);
					ids.notes.push(image?.noteId ?? null);
				}
				break;
			case 'subtree':
				ids.subtrees.push(op.id);
				for (const image of [op.before, op.after]) ids.people.push(image?.rootPersonId ?? null);
				break;
			case 'research_tasks':
				ids.tasks.push(op.id);
				for (const image of [op.before, op.after])
					addSubject(image?.subjectKind ?? null, image?.subjectId ?? null);
				break;
		}
	}
	return seedOf(ids);
}

/**
 * The rows to label and check an undo over, in two loads.
 *
 * The first brings the ops' records and what points at them. A row that would be left dangling
 * (a dependent, which refuses the undo and is named in the refusal) needs its own references to be
 * named, and the labeller numbers a partnership among the others of the same pair ("1st of 2"),
 * which are partnerships of its partners. Neither is in the first load, so the second names the
 * dependents and the partners of every partnership the first found, on top of the ops' records.
 */
export async function loadRowsForUndo(
	ops: readonly RowOp[],
	load: (seed: ScopeSeed) => Promise<TreeRows>
): Promise<TreeRows> {
	const first = await load(undoSeed(ops));
	const dependents = dependentsOfDeletions(first, [...ops]).map(
		(d) => ({ table: d.table, id: String(d.row.id), before: d.row, after: null }) as RowOp
	);
	const partners = first.unionPartners.map((p) => p.personId);
	if (dependents.length === 0 && partners.length === 0) return first;
	const seed = undoSeed([...ops, ...dependents]);
	return load(mergeSeeds(seed, seedOf({ people: partners })));
}
