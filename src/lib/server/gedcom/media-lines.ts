/**
 * The lines an `OBJE` keeps for its `FILE`s, shared by the import that stores them and the export
 * that writes them back (ADR-082).
 *
 * A `FILE` has several kept children that sit under different parents (a `TRAN` under the `FILE`,
 * an extension under its `FORM`, a `PHRASE` under its `MEDI`), but `media_items` has one
 * `gedcom_extra` column. The parent is told by the line's level, with the lines ordered deepest
 * parent first, so no marker has to be invented and the column still holds plain GEDCOM.
 */

import { collectLines, levelOfLine, shiftLevels, type GedcomNode } from './node';

/** The level a `FILE`'s kept children are stored at, by the structure they sit under. */
const FILE_CHILD_LEVEL = 2;
const FORM_CHILD_LEVEL = 3;

/** The kept children of one `FILE`, split by the structure each sits under. */
export interface FileExtras {
	/** Under `MEDI`, at level 4: the `PHRASE` that says what `OTHER` means. */
	medi: string[];
	/** Under `FORM` (other than `MEDI`), at level 3. */
	form: string[];
	/** Under the `FILE` itself, at level 2: `TRAN` and extensions. */
	file: string[];
}

/** A node's lines moved so the node sits at `level`, whatever level the file wrote it at. */
export function linesAt(node: GedcomNode, level: number): string[] {
	return shiftLevels(collectLines(node), level - node.level);
}

/** The stored column for a file's kept children, or null when it has none. */
export function joinFileExtras(extras: FileExtras): string[] | null {
	const lines = [...extras.medi, ...extras.form, ...extras.file];
	return lines.length > 0 ? lines : null;
}

/**
 * The column read back into its parts. Level 4 lines come first and run until the first line at
 * level 3 or shallower, the level 3 lines run until the first at level 2, and the rest are the
 * file's own, so a deeper child of a `TRAN` is never taken for a `PHRASE`.
 */
export function splitFileExtras(lines: readonly string[] | null | undefined): FileExtras {
	const all = lines ?? [];
	const isAtOrAbove = (line: string, level: number) => (levelOfLine(line) ?? level) <= level;
	const formAt = all.findIndex((line) => isAtOrAbove(line, FORM_CHILD_LEVEL));
	const mediEnd = formAt === -1 ? all.length : formAt;
	const fileAt = all.findIndex((line, i) => i >= mediEnd && isAtOrAbove(line, FILE_CHILD_LEVEL));
	const formEnd = fileAt === -1 ? all.length : fileAt;
	return {
		medi: all.slice(0, mediEnd),
		form: all.slice(mediEnd, formEnd),
		file: all.slice(formEnd)
	};
}
