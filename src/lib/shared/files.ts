/**
 * What the Files manager is sent. The `can*` flags are decided on the server from the caller's role
 * and the file's owner: the page shows an action only when its flag is set, and a flag is never a
 * reason to trust the client, since every write checks again.
 */

/** A record a file is linked to. A file is visible to a restricted viewer only when all of them are. */
export interface FileLinkDto {
	entityId: string;
	kind: 'person' | 'union' | 'source';
	/** The person's name, the partners' names, or the source's title. */
	label: string;
	/** The record's page. */
	href: string;
}

/** One file as the caller may see it. */
export interface FileRowDto {
	id: string;
	title: string | null;
	/** The row's version, sent back on rename, link and unlink so a stale edit is refused. */
	version: number;
	mimeType: string;
	/** Null for a file stored before sizes were recorded, until the size backfill has run. */
	sizeBytes: number | null;
	treeId: string;
	treeName: string;
	/** Every record the file is linked to; empty when it is detached or the caller has no role in the tree. */
	links: FileLinkDto[];
	/** Who uploaded it, shown to managers and owners only; null for everyone else and for unknown uploaders. */
	uploadedBy: string | null;
	/** Epoch milliseconds, or null for a row with no recorded time. */
	createdAt: number | null;
	/**
	 * The stored object's key, for `/api/media/<key>` (a thumbnail or preview). Null unless the caller
	 * may preview the file: the key is not a secret, but the serve route is the only thing that checks it.
	 */
	previewKey: string | null;
	canPreview: boolean;
	canRename: boolean;
	/** Link the file to a record or unlink it (`media:manage`). */
	canLink: boolean;
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

/**
 * An object in storage that no file row points at: left by a failed upload or a removed tree, and
 * still counted against the quota. `uploadedAt` is epoch milliseconds.
 */
export interface UnlinkedFileDto {
	key: string;
	treeId: string;
	treeName: string;
	sizeBytes: number;
	uploadedAt: number;
}

export interface UnlinkedListDto {
	files: UnlinkedFileDto[];
	totalBytes: number;
}
