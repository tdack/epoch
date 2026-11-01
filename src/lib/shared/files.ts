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

/** A further file of an object that has more than one, listed in the row's details. */
export interface ExtraFileDto {
	id: string;
	title: string | null;
	/** The row's version, sent back when the file is resolved. */
	version: number;
	mimeType: string;
	sizeBytes: number | null;
	isUnresolved: boolean;
	/** The `FILE` text as written; shown as plain text, never fetched. */
	gedcomPath: string | null;
	/** As `FileRowDto.previewKey`: null when unresolved or when the caller may not preview. */
	previewKey: string | null;
}

/** What the record a list was narrowed to says about an object: its pointer's title and place. */
export interface HostLinkDto {
	/** The `TITL` that overrides the file's title on this record; null when there is none. */
	title: string | null;
	/** The pointer's place among its siblings; null in the row means 0, read here as 0. */
	sortOrder: number;
}

/** One file as the caller may see it. */
export interface FileRowDto {
	id: string;
	/** The object (ADR-082) link, unlink and privacy ops name. Equals `id` for the first file until the contract migrations. */
	objectId: string;
	/** The object's version, sent back on link and unlink; the file's own `version` is for rename. */
	objectVersion: number;
	/** The file's bytes are not in Epoch: no preview, no download, no size. */
	isUnresolved: boolean;
	/** The `FILE` text as written, or null for a file uploaded in Epoch. Plain text; a link only when it is http(s). */
	gedcomPath: string | null;
	/** The object's other files, in order; the row stands for the first. Empty for the usual one-file object. */
	extraFiles: ExtraFileDto[];
	/** Set only when the list was narrowed to one record (`entityId`) and the object has a pointer from the record itself. */
	hostLink: HostLinkDto | null;
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
