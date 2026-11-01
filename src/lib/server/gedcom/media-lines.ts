/**
 * The lines an `OBJE` keeps for its `FILE`s, shared by the import that stores them and the export
 * that writes them back (ADR-082).
 *
 * A `FILE` has several kept children that sit under different parents (a `TRAN` under the `FILE`,
 * an extension under its `FORM`, a `PHRASE` under its `MEDI`), but `media_items` has one
 * `gedcom_extra` column. The parent is told by the line's level, with the lines ordered deepest
 * parent first, so no marker has to be invented and the column still holds plain GEDCOM.
 */

import { levelOfLine } from './node';

/** The level a `FILE`'s kept children are stored at, by the structure they sit under. */
const FILE_CHILD_LEVEL = 2;
const FORM_CHILD_LEVEL = 3;

/** The kept children of one `FILE`, split by the structure each sits under. */
interface FileExtras {
	/** Under `MEDI`, at level 4: the `PHRASE` that says what `OTHER` means. */
	medi: string[];
	/** Under `FORM` (other than `MEDI`), at level 3. */
	form: string[];
	/** Under the `FILE` itself, at level 2: `TRAN` and extensions. */
	file: string[];
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
