/**
 * The line-and-tree layer under the GEDCOM parser, kept apart so the evidence mapping and the
 * backfill read a retained block of lines with the very code an import reads a file with.
 */

export interface GedcomNode {
	level: number;
	tag: string;
	xref?: string;
	value?: string;
	rawLine: string;
	children: GedcomNode[];
}

/**
 * Parse a GEDCOM line into tokens, supporting both 5.5.1 and 7.0 syntax.
 *
 * GEDCOM 7 payloads may contain unescaped `@` characters (e.g. email
 * addresses), so the xref is only captured when it appears immediately after
 * the level on a record-bearing line (`0 @I1@ INDI`). Custom tags may exceed
 * the alphanumeric set, so the tag pattern is widened to `[^\s]+`.
 */
function parseGedcomLine(
	line: string
): { level: number; xref?: string; tag: string; value?: string } | null {
	const trimmed = line.trim();
	if (!trimmed) return null;

	const match = trimmed.match(/^(\d+)(?:\s+(@[^@]+@))?(?:\s+([^\s]+))?(?:\s+(.*))?$/);
	if (!match) return null;

	const level = parseInt(match[1], 10);
	const xref = match[2];
	const tag = match[3]?.toUpperCase();
	if (!tag) return null;

	return { level, xref, tag, value: match[4] };
}

/**
 * The structures in these lines, nested by level. A node at `rootLevel` starts a new root; a line
 * deeper than the root under it is its descendant, and one with no root above it is dropped.
 */
export function buildGedcomTree(lines: readonly string[], rootLevel = 0): GedcomNode[] {
	const roots: GedcomNode[] = [];
	const stack: GedcomNode[] = [];
	for (const line of lines) {
		const parsed = parseGedcomLine(line);
		if (!parsed) continue;
		const node: GedcomNode = {
			level: parsed.level,
			tag: parsed.tag,
			xref: parsed.xref,
			value: parsed.value,
			rawLine: line,
			children: []
		};
		if (node.level === rootLevel) {
			roots.push(node);
			stack.length = 0;
			stack.push(node);
		} else {
			while (stack.length > 0 && stack[stack.length - 1].level >= node.level) stack.pop();
			if (stack.length > 0) stack[stack.length - 1].children.push(node);
			stack.push(node);
		}
	}
	return roots;
}

/** The node's own line and every line beneath it, as written. */
export function collectLines(node: GedcomNode): string[] {
	const out = [node.rawLine];
	for (const c of node.children) out.push(...collectLines(c));
	return out;
}

/** The level a line is written at, or null for a line that is not GEDCOM. */
export function levelOfLine(line: string): number | null {
	return parseGedcomLine(line)?.level ?? null;
}

/**
 * The lines with every level moved by `delta`. A structure kept under one kind of record is written
 * under another when a merge moves it (a discarded fact's citation onto its partnership), and its
 * levels must follow.
 */
export function shiftLevels(lines: readonly string[], delta: number): string[] {
	if (delta === 0) return [...lines];
	return lines.map((line) =>
		line.replace(/^(\s*)(\d+)/, (_, space, level) => `${space}${Number(level) + delta}`)
	);
}
