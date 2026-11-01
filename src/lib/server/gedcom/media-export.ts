/**
 * What an exported `FILE` says. This is the seam the `.gdz` export replaces (ADR-082, Phase 4): a
 * plain `.ged` writes each file's own path, and an archive writes the entry path the file is stored
 * at. The dialect conversion of the text (a Windows path to a URI in 7.0, a percent-decoded
 * relative reference in 5.5.1) happens later, in `dialect.ts`, because it must apply to the lines a
 * file kept as well.
 */

import { extensionForMediaType } from '../../shared/media';

/** The columns of a stored file that decide its `FILE` text. */
export interface ExportableFile {
	id: string;
	/** The text the GEDCOM wrote, or null for a file uploaded in Epoch. */
	gedcomPath: string | null;
	title: string | null;
	mimeType: string;
}

const MAX_SLUG_LENGTH = 40;

/** A title as a file name: lower case, ASCII, words joined by `-`, never empty. */
function slugOf(title: string | null): string {
	const slug = (title ?? '')
		.normalize('NFKD')
		.replace(/[̀-ͯ]/g, '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, MAX_SLUG_LENGTH)
		.replace(/-+$/, '');
	return slug || 'file';
}

/**
 * The `FILE` text for a file in a plain `.ged`: its stored path as written, or for a file with
 * none a relative path under `media/` so a zip made by hand lines up. The made-up path is never
 * saved, so it can change with the title without disturbing the row.
 */
export function exportedFileText(file: ExportableFile): string {
	if (file.gedcomPath) return file.gedcomPath;
	const extension = extensionForMediaType(file.mimeType) ?? 'bin';
	return `media/${slugOf(file.title)}-${file.id.slice(0, 8)}.${extension}`;
}
