/**
 * Reads notes out of GEDCOM structures (ADR-029). Pure, and shared by the import and by the backfill
 * that moves a tree's retained notes into records, as `evidence-parse.ts` is for citations.
 *
 * Two shapes. A *shared* note is a root `NOTE` (5.5.1) or `SNOTE` (7.0) record with an XREF. A note
 * *under* a structure is either inline (the text is on its own line) or a pointer at a shared note;
 * both read into one `ParsedNoteLink`. The rule is the evidence rule: model a structure only when
 * the model can write it back exactly, and keep every other line verbatim and in order.
 */

import { collectLines, type GedcomNode } from './node';
import { fieldLayout, isContinuation, logicalText } from './evidence-lines';
import { NOTE_RECORD_TAGS, type NoteRecordTag } from '../../shared/notes';

const POINTER = /^@[^@\s]+@$/;

export interface ParsedNoteLink {
	/** The pointer on the line (`@N1@`); absent for an inline note. */
	pointer?: string;
	/** The tag the line was written with, so a pointer is written back as it came. */
	tag: NoteRecordTag;
	/** The words of an inline note. */
	text?: string;
	/** The file's own lines for the text when its split differs from the canonical one. */
	layout?: Record<string, string[]>;
	/** Every other line under the note (`MIME`, `LANG`, `TRAN`, a citation, a custom tag), verbatim. */
	extra: string[];
	/** The whole structure as written, for a place that cannot model it. */
	raw: string[];
}

export interface ParsedSharedNote {
	/** The XREF of the record. */
	id: string;
	tag: NoteRecordTag;
	text?: string;
	/** GEDCOM 7.0 `MIME`. */
	mime?: string;
	/** GEDCOM 7.0 `LANG`. */
	language?: string;
	layout?: Record<string, string[]>;
	extra: string[];
}

export const isNoteNode = (node: GedcomNode) => node.tag === 'NOTE' || node.tag === 'SNOTE';

const isPointer = (value: string | undefined): value is string =>
	!!value && POINTER.test(value.trim());

/**
 * A note under a structure as a link, or null when the model cannot write it back: an `SNOTE`
 * that is not a pointer, or an empty `NOTE`. The caller keeps those lines as it kept every note
 * before.
 */
export function parseNoteLink(node: GedcomNode): ParsedNoteLink | null {
	const tag = node.tag === 'SNOTE' ? NOTE_RECORD_TAGS.SNOTE : NOTE_RECORD_TAGS.NOTE;
	const value = node.value?.trim();
	if (isPointer(value)) {
		return {
			pointer: value,
			tag,
			extra: node.children.flatMap(collectLines),
			raw: collectLines(node)
		};
	}
	if (tag === NOTE_RECORD_TAGS.SNOTE) return null;
	const text = logicalText(node);
	if (!text) return null;
	const layout = fieldLayout(node);
	return {
		tag,
		text,
		...(layout ? { layout: { NOTE: layout } } : {}),
		extra: node.children.filter((c) => !isContinuation(c)).flatMap(collectLines),
		raw: collectLines(node)
	};
}

/**
 * The notes among these nodes, and the nodes that are not modelled notes, in their order. With
 * `isModelled` off every node is "other", which is how a tree imported before ADR-029 holds them.
 */
export function splitNotes(
	nodes: readonly GedcomNode[],
	isModelled: boolean,
	isSkipped: (node: GedcomNode) => boolean = () => false
): { notes: ParsedNoteLink[]; others: GedcomNode[] } {
	const notes: ParsedNoteLink[] = [];
	const others: GedcomNode[] = [];
	for (const node of nodes) {
		const link = isModelled && !isSkipped(node) && isNoteNode(node) ? parseNoteLink(node) : null;
		if (link) notes.push(link);
		else others.push(node);
	}
	return { notes, others };
}

/** A root `NOTE`/`SNOTE` record. The caller has checked it has an XREF. */
export function parseNoteRecord(node: GedcomNode): ParsedSharedNote {
	// The layout is computed over the line as if it had no XREF, so it can be written at any level
	// and under whichever XREF the record has then.
	const bare: GedcomNode = {
		...node,
		rawLine: node.rawLine.replace(/^(\s*\d+\s+)@[^@]+@\s*/, '$1')
	};
	const text = logicalText(node);
	const layout = text ? fieldLayout(bare) : undefined;
	let mime: string | undefined;
	let language: string | undefined;
	const extra: string[] = [];
	for (const child of node.children) {
		if (isContinuation(child)) continue;
		if (
			child.tag === 'MIME' &&
			mime === undefined &&
			child.children.length === 0 &&
			child.value?.trim()
		)
			mime = child.value.trim();
		else if (
			child.tag === 'LANG' &&
			language === undefined &&
			child.children.length === 0 &&
			child.value?.trim()
		)
			language = child.value.trim();
		else extra.push(...collectLines(child));
	}
	return {
		id: node.xref!,
		tag: node.tag === 'SNOTE' ? NOTE_RECORD_TAGS.SNOTE : NOTE_RECORD_TAGS.NOTE,
		...(text ? { text } : {}),
		...(mime ? { mime } : {}),
		...(language ? { language } : {}),
		...(layout ? { layout: { NOTE: layout } } : {}),
		extra
	};
}

/**
 * The identity of a note among a subject's own, for merging two files' notes without repeats: what
 * it says or points at, and which occurrence of that it is (two identical notes are two notes).
 */
export function noteLinkKey(c: { pointer?: string | null; text?: string | null }): string {
	return [c.pointer ?? '', c.text ?? ''].join('\u0000');
}

/** `into` followed by whatever `from` adds that `into` does not already say, occurrence by occurrence. */
export function mergeNoteLinks(into: ParsedNoteLink[], from: ParsedNoteLink[]): ParsedNoteLink[] {
	if (from.length === 0) return into;
	const have = new Map<string, number>();
	for (const n of into) have.set(noteLinkKey(n), (have.get(noteLinkKey(n)) ?? 0) + 1);
	const seen = new Map<string, number>();
	const added = from.filter((n) => {
		const key = noteLinkKey(n);
		const occurrence = (seen.get(key) ?? 0) + 1;
		seen.set(key, occurrence);
		return occurrence > (have.get(key) ?? 0);
	});
	return [...into, ...added];
}
