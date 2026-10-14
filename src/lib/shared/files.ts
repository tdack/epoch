/**
 * What the Files manager is sent. The `can*` flags are decided on the server from the caller's role
 * and the file's owner: the page shows an action only when its flag is set, and a flag is never a
 * reason to trust the client, since every write checks again.
 */

/** One file as the caller may see it. */
export interface FileRowDto {
	id: string;
	title: string | null;
	mimeType: string;
	/** Null for a file stored before sizes were recorded, until the size backfill has run. */
	sizeBytes: number | null;
	treeId: string;
	treeName: string;
	/** The person or partnership the file hangs off, or null when it is detached or hidden from the caller. */
	attachedTo: string | null;
	/** Who uploaded it, shown to managers and owners only; null for everyone else and for unknown uploaders. */
	uploadedBy: string | null;
	/** Epoch milliseconds, or null for a row with no recorded time. */
	createdAt: number | null;
	canPreview: boolean;
	canRename: boolean;
	canAttach: boolean;
	canDetach: boolean;
	canMove: boolean;
	canDelete: boolean;
}

/** A page of files. `nextCursor` is null when the listing is finished; a page may be short or empty while it is not. */
export interface FileListDto {
	files: FileRowDto[];
	nextCursor: string | null;
}

/** Storage used by one tree, against the limit uploads are refused at. */
interface TreeUsageDto {
	treeId: string;
	treeName: string;
	storedBytes: number;
	limitBytes: number;
}

/**
 * Storage the caller may see. `trees` lists only trees the caller may manage, since per-tree totals
 * are not shown to anyone below an editor. `installBytes` is the whole install's total and is set for
 * the install owner alone.
 */
export interface FileUsageDto {
	trees: TreeUsageDto[];
	installBytes: number | null;
}
