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
 * A line terminator. A lone `\r` (old Mac) is as valid as `\r\n` and `\n`, so all three split a
 * value into lines; splitting on `\n` alone leaves a `\r` inside a field, which then emits a line a
 * reader takes as a new record. The Unicode line separators split too, the same set `singleLine`
 * folds: a raw separator inside a value is one hazard whether the field may start a `CONT` with it
 * or must stay on a single line.
 */
// The C0 separators (`\x1c`–`\x1e`) are exactly what must split, so the usual "hidden typo" the
// control-character rule guards against does not apply here.
// eslint-disable-next-line no-control-regex
export const LINE_BREAK = /\r\n|[\r\n\v\f\x1c-\x1e\x85\u2028\u2029]/;

/**
 * The C0 and C1 controls except TAB, LF and CR, plus U+FFFE and U+FFFF, as a pattern built from
 * text so no raw control literal appears. The Unicode line separators `\u2028`/`\u2029` and NBSP
 * are kept.
 */
const BANNED_CONTROL_CHARS = new RegExp(
	// eslint-disable-next-line no-control-regex
	'[\\u0000-\\u0008\\u000b\\u000c\\u000e-\\u001f\\u007f\\u0080-\\u009f\\ufffe\\uffff]',
	'g'
);
/** A UTF-16 surrogate with no partner: a high not followed by a low, or a low not preceded by a high. */
const LONE_SURROGATES = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g;

/** Remove the code points GEDCOM forbids in text, without breaking an astral character. */
export function stripBannedChars(text: string): string {
	return text.replace(BANNED_CONTROL_CHARS, '').replace(LONE_SURROGATES, '');
}

/**
 * A node's value the way the model holds it: the banned code points gone, and a leading `@` the
 * file escaped as `@@` restored. A `CONC` value sits in the middle of its text and is only cleaned,
 * never unescaped, because a doubled `@` there is not an escape.
 */
export function normalizedNodeText(node: GedcomNode): string {
	const text = stripBannedChars(node.value ?? '');
	return node.tag !== 'CONC' && node.isAtEscaped && text.startsWith('@') ? text.slice(1) : text;
}

/** The canonical lines for a text: one line, and a `CONT` for each line break. */
function textLines(level: number, tag: string, text: string): string[] {
	const [first, ...rest] = stripBannedChars(text).split(LINE_BREAK);
	return [
		first ? `${level} ${tag} ${escapeText(first)}` : `${level} ${tag}`,
		...rest.map((line) => (line ? `${level + 1} CONT ${escapeText(line)}` : `${level + 1} CONT`))
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
 * Model text as a GEDCOM line writes it: the banned code points gone, and a leading `@` doubled so
 * the value can never be read back as a pointer. It is applied to every payload the model supplies,
 * never to a pointer, a tag or a `DATE` (whose `@#…@` calendar escape is the date dialect's) and
 * never to a line kept verbatim from an imported file.
 */
export function escapeText(text: string): string {
	const cleaned = stripBannedChars(text);
	return cleaned.startsWith('@') ? `@${cleaned}` : cleaned;
}

/** A text field that occupies one GEDCOM line: its terminators folded and its leading `@` escaped. */
export function escapedSingleLine(text: string | null | undefined): string | undefined {
	const line = singleLine(text);
	return line === undefined ? undefined : escapeText(line);
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
	if (!root) return null;
	let text = normalizedNodeText(root);
	for (const child of root.children) {
		if (child.tag === 'CONT') text += `\n${normalizedNodeText(child)}`;
		else if (child.tag === 'CONC') text += normalizedNodeText(child);
	}
	return text;
}

/**
 * A line kept as a text field's layout, with a lone leading `@` in its payload doubled. The layout
 * is the file's own split, written back byte-for-byte — except for this escape, which a built line
 * gets and a 5.5.1 file's own bytes do not. An already-doubled `@@` is left alone.
 */
function escapeKeptText(line: string): string {
	return stripBannedChars(line).replace(/^(\s*\d+\s+(?:@[^@\s]+@\s+)?\S+\s+)@(?!@)/, '$1@@');
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
		if (own !== null) return shiftLevels(layout.map(escapeKeptText), level - own);
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
