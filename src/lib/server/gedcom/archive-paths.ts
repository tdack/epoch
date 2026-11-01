/**
 * Which entry each stored file gets in an exported `.gdz`, and the `FILE` text that names it. One
 * mapping feeds both the dataset's `FILE` lines and the media segments' entry names, so they
 * cannot disagree (ADR-082).
 */

import { exportedFileText, type ExportableFile } from './media-export';
import { isReservedEntryName, normaliseEntryName } from './gedzip-paths';

export interface ArchiveFile extends ExportableFile {
	r2ObjectKey: string;
	sizeBytes: number | null;
	crc32: number | null;
}

/** One file to copy into the archive; persisted in the export's plan, so it is plain JSON. */
export interface ArchivePlanEntry {
	id: string;
	name: string;
	key: string;
	size: number | null;
	crc32: number | null;
}

const SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:/;

/** The entry name a stored `FILE` text asks for, or null when it is not a usable relative reference. */
function ownEntryName(gedcomPath: string | null): string | null {
	if (!gedcomPath || SCHEME.test(gedcomPath) || /[\\?#]|^[A-Za-z]:/.test(gedcomPath)) return null;
	if (/%(?![0-9A-Fa-f]{2})/.test(gedcomPath)) return null;
	try {
		const name = normaliseEntryName(decodeURIComponent(gedcomPath));
		return name.endsWith('/') || isReservedEntryName(name) ? null : name;
	} catch {
		return null;
	}
}

/** Percent-encode each segment, so the text is a URI reference that decodes back to the entry name. */
const fileTextOf = (name: string) => name.split('/').map(encodeURIComponent).join('/');

/**
 * Names the resolved `files` in the order given. Case-insensitive uniqueness, because an archive
 * is often unpacked on a case-folding disk.
 */
export function planArchiveFiles(files: readonly ArchiveFile[]): {
	entries: ArchivePlanEntry[];
	fileTexts: Map<string, string>;
} {
	const taken = new Set<string>();
	const claim = (name: string) => {
		const lower = name.toLowerCase();
		if (taken.has(lower)) return false;
		taken.add(lower);
		return true;
	};
	const entries: ArchivePlanEntry[] = [];
	const fileTexts = new Map<string, string>();
	for (const file of files) {
		let name = ownEntryName(file.gedcomPath);
		if (!name || !claim(name)) {
			name = exportedFileText({ ...file, gedcomPath: null });
			const dot = name.lastIndexOf('.');
			const stem = name.slice(0, dot);
			for (let n = 2; !claim(name); n++) name = `${stem}-${n}${name.slice(dot)}`;
		}
		entries.push({
			id: file.id,
			name,
			key: file.r2ObjectKey,
			size: file.sizeBytes,
			crc32: file.crc32
		});
		fileTexts.set(file.id, fileTextOf(name));
	}
	return { entries, fileTexts };
}
