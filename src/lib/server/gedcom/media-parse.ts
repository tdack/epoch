/**
 * Reads media records (`OBJE`), their `FILE`s and the pointers to them out of GEDCOM structures
 * (ADR-082). Pure; it never fetches or opens a path, which is stored as the text it was.
 *
 * The rule throughout is the one the evidence reader follows: model a structure only when the
 * model writes it back exactly, and keep every other line whole, in order, under the structure it
 * sat under. What a `FILE` keeps is split by level (see `media-lines.ts`).
 */

import { mediaTypeOf } from './dialect';
import { isPlainText, logicalText } from './evidence-lines';
import { joinFileExtras, linesAt } from './media-lines';
import type { GedcomNode } from './node';
import { PRIVACY_PUBLIC_TAG, RESTRICTING_RESN_WORDS } from './tags';

/** One `FILE` of a record, in file order. */
interface ParsedMediaFile {
	/** The `FILE` payload as written; never rewritten. */
	path: string;
	/** `FORM`, or the type the path implies when the file gave none or gave a word that is not a type. */
	mimeType: string;
	/** `MEDI` (5.5.1 `TYPE`), as written. */
	medium?: string;
	title?: string;
	/** Kept children of the `FILE`, `FORM` and `MEDI`, in the order `splitFileExtras` reads. */
	extra?: string[];
}

/** A media record: a `0 @x@ OBJE`, or an embedded 5.5.1 `OBJE` (which has no xref). */
export interface ParsedMediaObject {
	/** The xref for a record; `embedded:<n>` for an embedded copy. Pointers name an object by it. */
	key: string;
	xref?: string;
	privacy?: 'private' | 'public';
	files: ParsedMediaFile[];
	/** Kept children of the `OBJE` (notes, citations, `EXID`, `UID`, `REFN`, `CHAN`), at level 1. */
	extra: string[];
}

/** A pointer to a media record under a person, family, source or fact. */
export interface ParsedMediaLink {
	/** `ParsedMediaObject.key` of the object it points at. */
	objectKey: string;
	/** Only the sides the file gave. Absent when there is no `CROP` or it is not a plain one. */
	crop?: { top?: number; left?: number; height?: number; width?: number };
	/** The `TITL` that overrides the file's title for this use. */
	title?: string;
	/** Kept children of the pointer, at level 1 (a bare `CROP`, extensions). */
	extra: string[];
}

/** The text of a title that says nothing else, or null when it is empty or carries children. */
function plainTitle(node: GedcomNode): string | null {
	return isPlainText(node) && logicalText(node) ? logicalText(node) : null;
}

function parseFile(node: GedcomNode): { file: ParsedMediaFile; hasForm: boolean } {
	const path = node.value ?? '';
	const form: string[] = [];
	const medi: string[] = [];
	const own: string[] = [];
	let formNode: GedcomNode | undefined;
	let mediNode: GedcomNode | undefined;
	let title: string | undefined;
	for (const child of node.children) {
		if (child.tag === 'FORM' && !formNode) {
			formNode = child;
			for (const sub of child.children) {
				if ((sub.tag === 'MEDI' || sub.tag === 'TYPE') && !mediNode && sub.value?.trim()) {
					mediNode = sub;
					for (const phrase of sub.children) medi.push(...linesAt(phrase, 4));
				} else {
					form.push(...linesAt(sub, 3));
				}
			}
		} else if (child.tag === 'TITL' && title === undefined && plainTitle(child) !== null) {
			title = plainTitle(child)!;
		} else {
			own.push(...linesAt(child, 2));
		}
	}
	const extra = joinFileExtras({ medi, form, file: own });
	return {
		hasForm: formNode !== undefined,
		file: {
			path,
			mimeType: mediaTypeOf(formNode?.value, path),
			...(mediNode ? { medium: mediNode.value!.trim() } : {}),
			...(title !== undefined ? { title } : {}),
			...(extra ? { extra } : {})
		}
	};
}

/** What a media record holds, apart from the key it is known by. */
export function parseMediaBody(node: GedcomNode): Omit<ParsedMediaObject, 'key' | 'xref'> {
	const files: ParsedMediaFile[] = [];
	let isFirstFormless = false;
	const extra: string[] = [];
	let privacy: ParsedMediaObject['privacy'];
	// 5.5 put `FORM` and `TITL` beside the `FILE` rather than under it. They are the first file's
	// when it has none of its own; anywhere else they are kept lines.
	let objectForm: GedcomNode | undefined;
	let objectTitle: GedcomNode | undefined;
	for (const child of node.children) {
		if (child.tag === 'FILE') {
			const { file, hasForm } = parseFile(child);
			if (files.length === 0) isFirstFormless = !hasForm;
			files.push(file);
		} else if (
			child.tag === 'RESN' &&
			child.value?.split(',').some((w) => RESTRICTING_RESN_WORDS.has(w.trim().toLowerCase()))
		) {
			// As for a person: the restriction is the override, and a list with more in it is kept whole.
			privacy = 'private';
			if (child.value.trim().toUpperCase() !== 'PRIVACY') {
				extra.push(`1 RESN ${child.value.trim()}`);
			}
		} else if (child.tag === PRIVACY_PUBLIC_TAG && child.value?.trim().toLowerCase() === 'public') {
			privacy = 'public';
		} else if (child.tag === 'FORM' && !objectForm && child.children.length === 0) {
			objectForm = child;
		} else if (child.tag === 'TITL' && !objectTitle && plainTitle(child) !== null) {
			objectTitle = child;
		} else {
			extra.push(...linesAt(child, 1));
		}
	}
	const first = files[0];
	if (objectTitle) {
		if (first && first.title === undefined) first.title = plainTitle(objectTitle)!;
		else extra.push(...linesAt(objectTitle, 1));
	}
	if (objectForm) {
		if (first && isFirstFormless) first.mimeType = mediaTypeOf(objectForm.value, first.path);
		else extra.push(...linesAt(objectForm, 1));
	}
	return { ...(privacy ? { privacy } : {}), files, extra };
}

/** A record `0 @x@ OBJE`. */
export function parseMediaRecord(node: GedcomNode): ParsedMediaObject {
	return { key: node.xref!, xref: node.xref!, ...parseMediaBody(node) };
}

const CROP_TAGS = { TOP: 'top', LEFT: 'left', HEIGHT: 'height', WIDTH: 'width' } as const;

/**
 * A `CROP` the columns can hold: whole, non-negative pixel counts, each side at most once and
 * nothing else beneath. Anything else, including a `CROP` with no sides, is a kept line.
 */
function parseCrop(node: GedcomNode): ParsedMediaLink['crop'] | null {
	if (node.value?.trim() || node.children.length === 0) return null;
	const crop: NonNullable<ParsedMediaLink['crop']> = {};
	for (const side of node.children) {
		const key = CROP_TAGS[side.tag as keyof typeof CROP_TAGS];
		const text = side.value?.trim() ?? '';
		if (!key || key in crop || side.children.length > 0 || !/^\d{1,9}$/.test(text)) return null;
		crop[key] = Number(text);
	}
	return crop;
}

/** The pointer's own fields; `objectKey` says which object it names. */
export function parseMediaPointer(node: GedcomNode, objectKey: string): ParsedMediaLink {
	let crop: ParsedMediaLink['crop'];
	let title: string | undefined;
	const extra: string[] = [];
	for (const child of node.children) {
		const modelled = child.tag === 'CROP' && !crop ? parseCrop(child) : null;
		if (modelled) crop = modelled;
		else if (child.tag === 'TITL' && title === undefined && plainTitle(child) !== null)
			title = plainTitle(child)!;
		else extra.push(...linesAt(child, 1));
	}
	return {
		objectKey,
		...(crop ? { crop } : {}),
		...(title !== undefined ? { title } : {}),
		extra
	};
}

/**
 * Where a path is the same file in two embedded copies: separators unified and a leading `./`
 * dropped. Case is kept, because paths are case-sensitive in 7.0 and on R2.
 */
export function normalisedFilePath(path: string): string {
	return path
		.trim()
		.replace(/\\/g, '/')
		.replace(/^(?:\.\/)+/, '');
}

/** The `TITL` that sets a link apart from the object it points at, or undefined when it is the object's. */
export function linkTitleFor(
	own: string | undefined,
	object: ParsedMediaObject
): string | undefined {
	return own !== undefined && own !== object.files[0]?.title ? own : undefined;
}

/**
 * What makes two embedded copies one object beyond sharing a first path: every file, the format
 * and kind of each, the lines kept, and the restriction, but not the titles (a differing title is
 * the link's). A copy that says more than the first one is a different object, so nothing it says
 * is lost to the merge.
 */
export function embeddedContentKey(body: Omit<ParsedMediaObject, 'key' | 'xref'>): string {
	return JSON.stringify([
		body.files.map((f) => [
			normalisedFilePath(f.path),
			f.mimeType,
			f.medium ?? null,
			f.extra ?? []
		]),
		body.extra,
		body.privacy ?? null
	]);
}

/** `into` followed by the pointers `from` adds: one per object, as a host holds at most one. */
export function mergeMediaLinks(
	into: ParsedMediaLink[],
	from: ParsedMediaLink[]
): ParsedMediaLink[] {
	const known = new Set(into.map((link) => link.objectKey));
	const added: ParsedMediaLink[] = [];
	for (const link of from) {
		if (known.has(link.objectKey)) continue;
		known.add(link.objectKey);
		added.push(link);
	}
	return [...into, ...added];
}
