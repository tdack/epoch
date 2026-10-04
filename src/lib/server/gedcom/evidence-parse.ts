/**
 * Reads sources, repositories and citations out of GEDCOM structures (ADR-028). Pure, and shared by
 * the import and by the backfill that moves a tree's retained evidence into records, so the two
 * cannot map the same lines differently.
 *
 * The rule throughout: model a structure only when the model can write it back exactly. A field
 * that repeats, or has children the model has no place for, stays whole in `extra`, in order.
 */

import { collectLines, type GedcomNode } from './node';
import { fieldLayout, isContinuation, isPlainText, logicalText } from './evidence-lines';
import { splitNotes, type ParsedNoteLink } from './note-parse';

const POINTER = /^@[^@\s]+@$/;

export interface ParsedCitation {
	/** The pointer on the `SOUR` line (`@S1@`); absent for a 5.5.1 citation with inline text. */
	pointer?: string;
	/** The inline text of a citation that has no pointer. */
	description?: string;
	page?: string;
	/** `QUAY`, 0 to 3. */
	quality?: number;
	/** `DATA.DATE`, as written. */
	entryDate?: string;
	/** `DATA.TEXT` */
	text?: string;
	/** The file's own lines for a text field whose split differs from the canonical one. */
	layout?: Record<string, string[]>;
	/** The notes under the citation, in order. */
	notes: ParsedNoteLink[];
	/** Every other line under the citation, verbatim and in order. */
	extra: string[];
	/** The whole structure as written, for a place that cannot model it. */
	raw: string[];
}

export interface ParsedSourceRepository {
	/** `@R1@`, or absent for a `REPO` with no pointer. */
	pointer?: string;
	callNumber?: string;
	extra: string[];
}

export interface ParsedSource {
	id: string;
	title?: string;
	author?: string;
	publication?: string;
	abbreviation?: string;
	text?: string;
	layout?: Record<string, string[]>;
	repositories: ParsedSourceRepository[];
	notes: ParsedNoteLink[];
	extra: string[];
}

export interface ParsedRepository {
	id: string;
	name?: string;
	address?: string;
	layout?: Record<string, string[]>;
	notes: ParsedNoteLink[];
	extra: string[];
}

function isPointer(value: string | undefined): value is string {
	return !!value && POINTER.test(value.trim());
}

/** A text child of a record, taken once: a second one of the same tag stays in `extra`. */
function takeText(
	child: GedcomNode,
	layout: Record<string, string[]>,
	key: string,
	isWhole = false
): string | undefined {
	const text = logicalText(child);
	if (!text) return undefined;
	const lines = fieldLayout(child, isWhole);
	if (lines) layout[key] = lines;
	return text;
}

/** `DATA` with only one `DATE` and one `TEXT` under it, each plain: the shape the model can write back. */
function isModellableData(node: GedcomNode): boolean {
	if (node.value?.trim() || node.children.length === 0) return false;
	const tags = node.children.map((c) => c.tag);
	if (tags.some((t) => t !== 'DATE' && t !== 'TEXT')) return false;
	if (new Set(tags).size !== tags.length) return false;
	return node.children.every((c) =>
		c.tag === 'DATE' ? !!c.value?.trim() && c.children.length === 0 : isPlainText(c)
	);
}

export function parseCitation(node: GedcomNode, isNotesModelled = true): ParsedCitation {
	const value = node.value?.trim();
	const pointer = isPointer(value) ? value : undefined;
	const layout: Record<string, string[]> = {};
	const extra: string[] = [];
	let description: string | undefined;
	if (!pointer) {
		description = takeText(node, layout, 'SOUR');
	}
	let page: string | undefined;
	let quality: number | undefined;
	let entryDate: string | undefined;
	let text: string | undefined;
	let isDataTaken = false;
	const { notes, others } = splitNotes(node.children, isNotesModelled);
	for (const child of others) {
		// Continuation lines of the inline text were read with it; under a pointer they are strays.
		if (!pointer && isContinuation(child)) continue;
		if (child.tag === 'PAGE' && page === undefined && isPlainText(child) && logicalText(child)) {
			page = takeText(child, layout, 'PAGE');
		} else if (
			child.tag === 'QUAY' &&
			quality === undefined &&
			child.children.length === 0 &&
			/^[0-3]$/.test(child.value?.trim() ?? '')
		) {
			quality = Number(child.value!.trim());
		} else if (child.tag === 'DATA' && !isDataTaken && isModellableData(child)) {
			isDataTaken = true;
			for (const part of child.children) {
				if (part.tag === 'DATE') entryDate = part.value!.trim();
				else text = takeText(part, layout, 'TEXT');
			}
		} else {
			extra.push(...collectLines(child));
		}
	}
	return {
		...(pointer ? { pointer } : {}),
		...(description ? { description } : {}),
		...(page ? { page } : {}),
		...(quality !== undefined ? { quality } : {}),
		...(entryDate ? { entryDate } : {}),
		...(text ? { text } : {}),
		...(Object.keys(layout).length > 0 ? { layout } : {}),
		notes,
		extra,
		raw: collectLines(node)
	};
}

/** The identity of a citation among a subject's own, for merging two files' evidence without repeats. */
function citationKey(c: {
	pointer?: string | null;
	description?: string | null;
	page?: string | null;
	text?: string | null;
}): string {
	return [c.pointer, c.description, c.page, c.text].map((part) => part ?? '').join('\u0000');
}

/** `into` followed by whatever `from` adds that `into` does not already say. */
export function mergeCitations(into: ParsedCitation[], from: ParsedCitation[]): ParsedCitation[] {
	if (from.length === 0) return into;
	const known = new Set(into.map(citationKey));
	const added = from.filter((c) => {
		const key = citationKey(c);
		if (known.has(key)) return false;
		known.add(key);
		return true;
	});
	return [...into, ...added];
}

function parseSourceRepository(node: GedcomNode): ParsedSourceRepository {
	const value = node.value?.trim();
	const caln = node.children.find((c) => c.tag === 'CALN' && !!c.value?.trim());
	const extra: string[] = [];
	if (caln) extra.push(...caln.children.flatMap(collectLines));
	for (const child of node.children) if (child !== caln) extra.push(...collectLines(child));
	return {
		...(isPointer(value) ? { pointer: value } : {}),
		...(caln ? { callNumber: caln.value!.trim() } : {}),
		extra
	};
}

const SOURCE_FIELDS = {
	TITL: 'title',
	AUTH: 'author',
	PUBL: 'publication',
	ABBR: 'abbreviation',
	TEXT: 'text'
} as const;

export function parseSourceRecord(node: GedcomNode, isNotesModelled = true): ParsedSource {
	const layout: Record<string, string[]> = {};
	const fields: Partial<Record<(typeof SOURCE_FIELDS)[keyof typeof SOURCE_FIELDS], string>> = {};
	const repositories: ParsedSourceRepository[] = [];
	const extra: string[] = [];
	const { notes, others } = splitNotes(node.children, isNotesModelled);
	for (const child of others) {
		const field = SOURCE_FIELDS[child.tag as keyof typeof SOURCE_FIELDS];
		if (field && fields[field] === undefined && isPlainText(child) && logicalText(child)) {
			fields[field] = takeText(child, layout, child.tag);
		} else if (child.tag === 'REPO' && (!child.value?.trim() || isPointer(child.value))) {
			repositories.push(parseSourceRepository(child));
		} else {
			extra.push(...collectLines(child));
		}
	}
	return {
		id: node.xref!,
		...fields,
		...(Object.keys(layout).length > 0 ? { layout } : {}),
		repositories,
		notes,
		extra
	};
}

export function parseRepositoryRecord(node: GedcomNode, isNotesModelled = true): ParsedRepository {
	const layout: Record<string, string[]> = {};
	const extra: string[] = [];
	let name: string | undefined;
	let address: string | undefined;
	const { notes, others } = splitNotes(node.children, isNotesModelled);
	for (const child of others) {
		if (child.tag === 'NAME' && name === undefined && isPlainText(child) && logicalText(child)) {
			name = takeText(child, layout, 'NAME');
		} else if (child.tag === 'ADDR' && address === undefined && logicalText(child)) {
			address = takeText(child, layout, 'ADDR', true);
		} else {
			extra.push(...collectLines(child));
		}
	}
	return {
		id: node.xref!,
		...(name ? { name } : {}),
		...(address ? { address } : {}),
		...(Object.keys(layout).length > 0 ? { layout } : {}),
		notes,
		extra
	};
}
