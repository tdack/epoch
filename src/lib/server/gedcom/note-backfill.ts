/**
 * Moves the notes a tree kept as retained lines, in a row's extra lines, or in a fact's `notes`
 * column (imported before ADR-029) into note records.
 *
 * Pure, as `evidence-backfill.ts` is: `scripts/backfill-notes.mjs` reads the rows `NOTE_BACKFILL_QUERIES`
 * names, hands them to `noteBackfillStatements`, and runs the SQL it returns. The lines are read with
 * the import's own parser and become rows with the import's own row builders, so a tree backfilled
 * from retained lines and the same file imported afresh hold the same records.
 *
 * It never invents a link: a free-text note becomes a note, not a citation or a source. It runs
 * after the evidence backfill, because a note under a source, a repository or a citation can only
 * be reached once those are records; running it again afterwards moves what is left.
 *
 * Idempotent by construction: a line is removed from where it was kept in the same run that stores
 * it, so a second run finds nothing to move. A line that cannot be placed stays.
 */

import { noteAttachments, notes } from '../db/schema';
import { NOTE_SUBJECT_KINDS, type NoteSubjectKind } from '../../shared/notes';
import { buildGedcomTree, collectLines, levelOfLine, type GedcomNode } from './node';
import { normalizeModelText } from './parser';
import { LINE_BREAK } from './evidence-lines';
import { isNoteNode, parseNoteLink, parseNoteRecord, type ParsedNoteLink } from './note-parse';
import { noteAttachmentRow, noteRow } from './note-rows';
import { treeScopedId } from './import-preview';
import { NAME_CHANGE_NOTE } from './tags';
import {
	indexTrees,
	insertStatement,
	jsonList,
	quote,
	type BackfillInput,
	type TreeIndex
} from './evidence-backfill';

/** The reads the backfill needs, as plain SQL so the script can run them through wrangler. */
export const NOTE_BACKFILL_QUERIES = {
	preserved:
		'SELECT id, tree_id, owner_xref, lines FROM gedcom_preserved ORDER BY tree_id, "order"',
	events:
		'SELECT id, tree_id, entity_type, entity_id, gedcom_extra, notes FROM events WHERE gedcom_extra IS NOT NULL OR notes IS NOT NULL ORDER BY rowid',
	names:
		'SELECT n.id AS id, i.tree_id AS tree_id, n.gedcom_extra AS gedcom_extra, n.union_id AS union_id, n.date_raw AS date_raw FROM person_names n JOIN individuals i ON i.id = n.person_id WHERE n.gedcom_extra IS NOT NULL ORDER BY n.rowid',
	individuals: 'SELECT id, tree_id, xref_id, xref_aliases FROM individuals',
	unions: 'SELECT id, tree_id, xref_aliases FROM unions',
	partners: 'SELECT union_id, person_id, "order" AS "order" FROM union_partners',
	links:
		'SELECT id, tree_id, parent_id, child_id, union_id FROM parent_child WHERE union_id IS NOT NULL ORDER BY rowid',
	sources: 'SELECT id, tree_id, xref, xref_aliases, gedcom_extra FROM sources ORDER BY rowid',
	repositories:
		'SELECT id, tree_id, xref, xref_aliases, gedcom_extra FROM repositories ORDER BY rowid',
	citations:
		'SELECT id, tree_id, gedcom_extra FROM citations WHERE gedcom_extra IS NOT NULL ORDER BY rowid',
	notes: 'SELECT id, tree_id, xref, xref_aliases FROM notes',
	noteOrder:
		'SELECT subject_kind, subject_id, max(sort_order) + 1 AS next FROM note_attachments GROUP BY subject_kind, subject_id'
} as const;

/** What each query answers, as D1 returns it: JSON columns still text. */
export interface NoteBackfillInput extends Pick<
	BackfillInput,
	'preserved' | 'individuals' | 'unions' | 'partners' | 'links'
> {
	events: Array<{
		id: string;
		tree_id: string;
		entity_type: string;
		entity_id: string;
		gedcom_extra: string | null;
		notes: string | null;
	}>;
	names: Array<{
		id: string;
		tree_id: string;
		gedcom_extra: string;
		union_id: string | null;
		date_raw: string | null;
	}>;
	sources: Array<{
		id: string;
		tree_id: string;
		xref: string | null;
		xref_aliases: string | null;
		gedcom_extra: string | null;
	}>;
	repositories: Array<{
		id: string;
		tree_id: string;
		xref: string | null;
		xref_aliases: string | null;
		gedcom_extra: string | null;
	}>;
	citations: Array<{ id: string; tree_id: string; gedcom_extra: string }>;
	notes: Array<{ id: string; tree_id: string; xref: string | null; xref_aliases: string | null }>;
	noteOrder: Array<{ subject_kind: string; subject_id: string; next: number }>;
}

/** Lines as the nodes at their own top level; the level is read, not assumed, as `keptLines` does. */
function nodesOf(lines: string[]): GedcomNode[] {
	const level = levelOfLine(lines[0] ?? '');
	if (level === null) return [];
	const nodes = buildGedcomTree(lines, level);
	normalizeModelText(nodes);
	return nodes;
}

/** A fact's `notes` column as the note line it was read from. */
function columnNoteNode(text: string): GedcomNode | undefined {
	const [first, ...rest] = text.split(LINE_BREAK);
	// The column holds the first note's payload as the file wrote it — a pointer `@N1@` or an escaped
	// text `@@N1@` — so rebuilding the line and reading it takes the same path a fresh import did.
	const lines = [
		first ? `2 NOTE ${first}` : '2 NOTE',
		...rest.map((l) => (l ? `3 CONT ${l}` : '3 CONT'))
	];
	const nodes = buildGedcomTree(lines, 2);
	normalizeModelText(nodes);
	return nodes[0];
}

/**
 * The SQL that stores every piece of retained notes as a record and removes it from where it was
 * kept. Empty when there is nothing left to move.
 */
export function noteBackfillStatements(input: NoteBackfillInput, now = new Date()): string[] {
	const statements: string[] = [];
	const trees = indexTrees(input);
	const noteByXref = new Map<string, Map<string, string>>();
	const notesOf = (treeId: string) => {
		let map = noteByXref.get(treeId);
		if (!map) {
			map = new Map();
			noteByXref.set(treeId, map);
		}
		return map;
	};
	for (const n of input.notes) {
		const map = notesOf(n.tree_id);
		if (n.xref) map.set(n.xref, n.id);
		for (const alias of jsonList(n.xref_aliases)) map.set(alias, n.id);
	}
	const nextOrder = new Map<string, number>(
		input.noteOrder.map((c) => [`${c.subject_kind}|${c.subject_id}`, c.next] as const)
	);
	const removedPreserved = new Set<string>();

	const store = (
		treeId: string,
		kind: NoteSubjectKind,
		subjectId: string,
		list: ParsedNoteLink[]
	) => {
		const map = notesOf(treeId);
		for (const parsed of list) {
			const key = `${kind}|${subjectId}`;
			const order = nextOrder.get(key) ?? 0;
			nextOrder.set(key, order + 1);
			const noteId = parsed.pointer ? (map.get(parsed.pointer) ?? null) : null;
			statements.push(
				insertStatement(
					noteAttachments,
					noteAttachmentRow(
						treeId,
						crypto.randomUUID(),
						{ kind, id: subjectId },
						parsed,
						noteId,
						order,
						now
					)
				)
			);
		}
	};

	/** The notes among these nodes that the model can write back, and the lines of everything else. */
	const takeNotes = (nodes: GedcomNode[], isSkipped: (n: GedcomNode) => boolean = () => false) => {
		const taken: ParsedNoteLink[] = [];
		const rest: string[] = [];
		for (const node of nodes) {
			const link = !isSkipped(node) && isNoteNode(node) ? parseNoteLink(node) : null;
			if (link) taken.push(link);
			else rest.push(...collectLines(node));
		}
		return { taken, rest };
	};

	const preservedByTree = new Map<string, NoteBackfillInput['preserved']>();
	for (const p of input.preserved) {
		const list = preservedByTree.get(p.tree_id);
		if (list) list.push(p);
		else preservedByTree.set(p.tree_id, [p]);
	}

	for (const [treeId, entries] of preservedByTree) {
		const index = trees.get(treeId);
		if (!index) continue;
		const map = notesOf(treeId);

		// Shared notes first, so a pointer to one resolves.
		for (const entry of entries) {
			const lines = jsonList(entry.lines);
			const node = lines[0]?.startsWith('0 ') ? nodesOf(lines)[0] : undefined;
			if (!node || !isNoteNode(node) || !node.xref) continue;
			removedPreserved.add(entry.id);
			if (map.has(node.xref)) continue;
			const id = treeScopedId(treeId, node.xref);
			map.set(node.xref, id);
			statements.push(insertStatement(notes, noteRow(treeId, id, parseNoteRecord(node), now)));
		}

		for (const entry of entries) {
			if (removedPreserved.has(entry.id) || !entry.owner_xref) continue;
			const lines = jsonList(entry.lines);
			const head = lines[0] ?? '';
			const personId = index.personByXref.get(entry.owner_xref);
			const unionId = index.unionByXref.get(entry.owner_xref);

			if (/^1 S?NOTE(\s|$)/.test(head)) {
				const subject = personId
					? ([NOTE_SUBJECT_KINDS.PERSON, personId] as const)
					: unionId
						? ([NOTE_SUBJECT_KINDS.UNION, unionId] as const)
						: null;
				const [node] = nodesOf(lines);
				const link = subject && node ? parseNoteLink(node) : null;
				if (!subject || !link) continue;
				store(treeId, subject[0], subject[1], [link]);
				removedPreserved.add(entry.id);
			} else if (personId && /^1 FAMC\s+\S+/.test(head)) {
				const [famc] = nodesOf(lines);
				const familyUnion = famc?.value ? index.unionByXref.get(famc.value.trim()) : undefined;
				if (!famc || !familyUnion) continue;
				const { taken, rest } = takeNotes(famc.children);
				if (taken.length === 0) continue;
				const firstParent = (index.partners.get(familyUnion) ?? []).find((parentId) =>
					index.linkOf.has(`${familyUnion}|${personId}|${parentId}`)
				);
				const linkId = firstParent
					? index.linkOf.get(`${familyUnion}|${personId}|${firstParent}`)
					: undefined;
				if (!linkId) continue;
				store(treeId, NOTE_SUBJECT_KINDS.PARENT_CHILD, linkId, taken);
				if (rest.length === 0) {
					removedPreserved.add(entry.id);
				} else {
					statements.push(
						`UPDATE gedcom_preserved SET lines = ${quote(JSON.stringify([famc.rawLine, ...rest]))} WHERE id = ${quote(entry.id)};`
					);
				}
			}
		}
	}
	for (const id of removedPreserved)
		statements.push(`DELETE FROM gedcom_preserved WHERE id = ${quote(id)};`);

	/** Notes among a row's extra lines moved out, and the column rewritten with the rest. */
	const moveFromExtra = (
		table: 'events' | 'person_names' | 'sources' | 'repositories' | 'citations',
		kind: NoteSubjectKind,
		row: { id: string; tree_id: string; gedcom_extra: string | null },
		options: {
			/** A leading note the row already says in a column, taken first. */
			leading?: ParsedNoteLink[];
			isSkipped?: (n: GedcomNode) => boolean;
			clearsColumn?: string;
		} = {}
	) => {
		const lines = jsonList(row.gedcom_extra);
		const { taken, rest } = takeNotes(nodesOf(lines), options.isSkipped);
		const all = [...(options.leading ?? []), ...taken];
		if (all.length === 0) return;
		store(row.tree_id, kind, row.id, all);
		const sets = [
			...(taken.length > 0
				? [`gedcom_extra = ${rest.length > 0 ? quote(JSON.stringify(rest)) : 'NULL'}`]
				: []),
			...(options.clearsColumn ? [`${options.clearsColumn} = NULL`] : [])
		];
		statements.push(`UPDATE ${table} SET ${sets.join(', ')} WHERE id = ${quote(row.id)};`);
	};

	for (const row of input.events) {
		const column = row.notes ? columnNoteNode(row.notes) : undefined;
		const link = column ? parseNoteLink(column) : null;
		moveFromExtra('events', NOTE_SUBJECT_KINDS.EVENT, row, {
			leading: link ? [link] : [],
			clearsColumn: link ? 'notes' : undefined
		});
	}
	for (const row of input.names) {
		// A name-change note (ADR-013) is Epoch's own, never a user's note. When the name's columns hold
		// it, nothing in the extras is it; when they do not (its family was not in the file), the first
		// such note among the extras is that note, kept as written.
		const hasColumns = row.union_id !== null || row.date_raw !== null;
		let isChangeNoteSeen = hasColumns;
		moveFromExtra('person_names', NOTE_SUBJECT_KINDS.NAME, row, {
			isSkipped: (n) => {
				if (isChangeNoteSeen) return false;
				const isChange =
					n.tag === 'NOTE' &&
					n.children.length === 0 &&
					!!n.value &&
					NAME_CHANGE_NOTE.test(n.value.trim());
				if (isChange) isChangeNoteSeen = true;
				return isChange;
			}
		});
	}
	for (const row of input.sources) moveFromExtra('sources', NOTE_SUBJECT_KINDS.SOURCE, row);
	for (const row of input.repositories)
		moveFromExtra('repositories', NOTE_SUBJECT_KINDS.REPOSITORY, row);
	for (const row of input.citations) moveFromExtra('citations', NOTE_SUBJECT_KINDS.CITATION, row);

	return statements;
}

export type { TreeIndex };
