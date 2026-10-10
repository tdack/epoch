/**
 * Text fields in GEDCOM lines, in both directions (ADR-028). A value longer than a line, or with a
 * line break, is written as the tag's line followed by `CONT` (a new line) and `CONC` (the same
 * line, continued) lines. The model keeps the logical text; the file's own split is kept beside it
 * as a *layout* and written back only while it still says the same text, so a file comes back as it
 * was and an edit is never overridden by stale lines.
 */

import { buildGedcomTree, collectLines, levelOfLine, shiftLevels, type GedcomNode } from './node';

export const isContinuation = (node: GedcomNode) => node.tag === 'CONT' || node.tag === 'CONC';

/** The text a line and its `CONT`/`CONC` children say. Other children are not part of it. */
export function logicalText(node: GedcomNode): string {
	let text = node.value ?? '';
	for (const child of node.children) {
		if (child.tag === 'CONT') text += `\n${child.value ?? ''}`;
		else if (child.tag === 'CONC') text += child.value ?? '';
	}
	return text;
}

/** True when the node's children are nothing but continuation lines, so its text is all it says. */
export function isPlainText(node: GedcomNode): boolean {
	return node.children.every(isContinuation);
}

/**
 * A GEDCOM line terminator. A lone `\r` (old Mac) is as valid as `\r\n` and `\n`, so all three split
 * a value into lines; splitting on `\n` alone leaves a `\r` inside a field, which then emits a line
 * a reader takes as a new record.
 */
export const LINE_BREAK = /\r\n|\r|\n/;

/** The canonical lines for a text: one line, and a `CONT` for each line break. */
function textLines(level: number, tag: string, text: string): string[] {
	const [first, ...rest] = text.split(LINE_BREAK);
	return [
		first ? `${level} ${tag} ${first}` : `${level} ${tag}`,
		...rest.map((line) => (line ? `${level + 1} CONT ${line}` : `${level + 1} CONT`))
	];
}

/**
 * The text of a field that must occupy one GEDCOM line: every terminator — `\r\n`, `\r`, `\n` and
 * the Unicode line separators (`\v`, `\f`, `\x1c`–`\x1e`, `\x85`, `\u2028`, `\u2029`) — folds to a
 * single space, so the field can never emit a second line. `null` and `undefined` stay absent.
 */
export function singleLine(text: string | null | undefined): string | undefined {
	if (text === null || text === undefined) return undefined;
	// The C0 separators (`\x1c`–`\x1e`) are exactly what must fold, so the usual "hidden typo" the
	// control-character rule guards against does not apply here.
	// eslint-disable-next-line no-control-regex
	return text.replace(/[\r\n\v\f\x1c-\x1e\x85\u2028\u2029]+/g, ' ');
}

/**
 * The file's lines for a text field when they differ from the canonical ones (a `CONC` split, odd
 * spacing, an address with sub-tags), else undefined. `isWhole` also keeps the children that are not
 * continuations, which an address needs for its `CITY` and `POST`.
 */
export function fieldLayout(node: GedcomNode, isWhole = false): string[] | undefined {
	const lines = isWhole
		? collectLines(node)
		: [node.rawLine, ...node.children.filter(isContinuation).flatMap(collectLines)];
	const canonical = textLines(node.level, node.tag, logicalText(node));
	return lines.length === canonical.length && lines.every((line, i) => line === canonical[i])
		? undefined
		: lines;
}

/** The text a block of lines says, read the way the import read it. */
function textOfLines(lines: readonly string[]): string | null {
	const level = levelOfLine(lines[0] ?? '');
	if (level === null) return null;
	const root = buildGedcomTree(lines, level)[0];
	return root ? logicalText(root) : null;
}

/**
 * The lines to write for a text field at `level`: nothing for no text; the file's own lines (moved
 * to `level`) when `layout` still says this text; otherwise the canonical ones.
 */
export function fieldLines(
	level: number,
	tag: string,
	text: string | null | undefined,
	layout?: readonly string[] | null
): string[] {
	if (!text) return [];
	if (layout && layout.length > 0 && textOfLines(layout) === text) {
		const own = levelOfLine(layout[0]);
		if (own !== null) return shiftLevels(layout, level - own);
	}
	return textLines(level, tag, text);
}

/**
 * Lines kept beside a record, moved so their first line sits at `level`. A kept structure is
 * written under a different kind of record when a merge moves it, and its levels must follow.
 */
export function keptLines(level: number, lines: readonly string[] | null | undefined): string[] {
	if (!lines || lines.length === 0) return [];
	const own = levelOfLine(lines[0]);
	return own === null ? [...lines] : shiftLevels(lines, level - own);
}
