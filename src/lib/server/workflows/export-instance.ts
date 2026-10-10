/**
 * The identity of an asynchronous export: the workflow instance id a client is handed (never the
 * R2 key it will read), the object key that instance writes, and how Cloudflare's own workflow
 * status maps onto the small set a client understands. One module, so the id an export is created
 * under and the id a later download is looked up by cannot drift apart.
 *
 * A client is given the instance id and nothing else: the R2 key is derived here from the same
 * parts, so a caller can never name an object the workflow did not write.
 */

import { ValidationError } from '../domain/errors';
import type { GedcomFormat } from '../gedcom/tags';

/** Every export object lives under this R2 prefix; the lifecycle rule that expires them is scoped to it. */
export const EXPORT_LIFECYCLE_PREFIX = 'exports/';

/** How long a finished export may be downloaded after it was written (24 hours), enforced at read time. */
export const EXPORT_TTL_SECONDS = 86400;

/** Cloudflare rejects an instance id longer than this. */
const MAX_INSTANCE_ID_LENGTH = 100;

const UUID_PATTERN = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

/**
 * The one pattern an instance id is read with, anchored at both ends. It is never split on `_`:
 * splitting would let a crafted tree id or client id containing a separator forge another id.
 */
const INSTANCE_ID_PATTERN = new RegExp(
	`^export_(${UUID_PATTERN})_(g551|g7|g7z)_(${UUID_PATTERN})$`
);

/** The short token that carries the format and the packaging inside an instance id. */
export type ExportFormatToken = 'g551' | 'g7' | 'g7z';

/** What a parsed instance id tells the caller: enough to authorise, and to name the object key. */
export interface ParsedExportInstance {
	treeId: string;
	token: ExportFormatToken;
	format: GedcomFormat;
	shouldCompress: boolean;
	clientUuid: string;
}

function tokenFor(format: GedcomFormat, shouldCompress: boolean): ExportFormatToken {
	if (format === 'gedcom551') {
		// GEDZip is defined for 7.0 alone; a `.gdz` cannot hold a 5.5.1 file.
		if (shouldCompress) throw new ValidationError('A .gdz archive can only hold a GEDCOM 7.0 file');
		return 'g551';
	}
	return shouldCompress ? 'g7z' : 'g7';
}

function formatFor(token: ExportFormatToken): { format: GedcomFormat; shouldCompress: boolean } {
	if (token === 'g551') return { format: 'gedcom551', shouldCompress: false };
	return { format: 'gedcom7', shouldCompress: token === 'g7z' };
}

/**
 * Build the workflow instance id for an export. It is charset-safe and never longer than
 * Cloudflare accepts; an input that would break either is refused rather than truncated, because a
 * truncated id could collide with another export.
 *
 * @param treeId - The exporting tree, a UUID.
 * @param format - The GEDCOM dialect.
 * @param shouldCompress - Package as GEDZip; only meaningful for 7.0.
 * @param clientUuid - A per-attempt id from the client, so a retry can be told apart from a new click.
 * @returns `export_<treeId>_<token>_<clientUuid>`.
 * @throws ValidationError - If `shouldCompress` is asked for a 5.5.1 file.
 * @throws Error - If either id is not a UUID, or the result would be too long to be an instance id.
 */
export function buildExportInstanceId(
	treeId: string,
	format: GedcomFormat,
	shouldCompress: boolean,
	clientUuid: string
): string {
	const id = `export_${treeId}_${tokenFor(format, shouldCompress)}_${clientUuid}`;
	if (id.length > MAX_INSTANCE_ID_LENGTH || parseExportInstanceId(id) === null) {
		throw new Error(`Refusing to build an export instance id from unsafe input: ${id}`);
	}
	return id;
}

/** Read an instance id back, or null when it is not one this application ever minted. */
export function parseExportInstanceId(instanceId: string): ParsedExportInstance | null {
	const match = INSTANCE_ID_PATTERN.exec(instanceId);
	if (!match) return null;
	const token = match[2] as ExportFormatToken;
	return {
		treeId: match[1]!,
		token,
		clientUuid: match[3]!,
		...formatFor(token)
	};
}

/**
 * The R2 key an export's instance writes. The prefix is the lifecycle rule's scope. The format
 * token sits in the name as well as the extension: a `.ged` file can be 5.5.1 or 7.0, so without
 * the token a client id reused across two dialects would collide and serve the wrong one.
 */
export function exportObjectKey(
	treeId: string,
	token: ExportFormatToken,
	clientUuid: string
): string {
	const extension = token === 'g7z' ? 'gdz' : 'ged';
	return `${EXPORT_LIFECYCLE_PREFIX}${treeId}-${token}-${clientUuid}.${extension}`;
}

/**
 * Whether a stored object key is exactly the one an instance id names. Exact equality, never a
 * prefix or suffix test, so a key that merely looks similar (a longer client id, another tree) is
 * refused rather than served.
 */
export function matchesExportKey(fileKey: string, parsed: ParsedExportInstance): boolean {
	return fileKey === exportObjectKey(parsed.treeId, parsed.token, parsed.clientUuid);
}

/**
 * A stored object's write time: the upload time this application recorded when it wrote the object,
 * falling back to R2's own `uploaded`. R2's field is reset by a copy or a re-upload, so the recorded
 * time is the authoritative one and the fallback only covers an object written before it existed.
 */
export function exportWriteTime(object: {
	uploaded: Date;
	customMetadata?: Record<string, string>;
}): Date {
	const recorded = object.customMetadata?.uploadedAt;
	if (recorded) {
		const parsed = new Date(recorded);
		if (!Number.isNaN(parsed.getTime())) return parsed;
	}
	return object.uploaded;
}

/** Whether an export has outlived the retention window, measured from when it was written. */
export function isExportExpired(writtenAt: Date, now: Date = new Date()): boolean {
	return now.getTime() - writtenAt.getTime() > EXPORT_TTL_SECONDS * 1000;
}

/**
 * Cloudflare's workflow status union, as observed by `status()`. `status()` reports only
 * `{ status, error?, output? }`; the params an instance was created with are not readable, which is
 * why the id itself carries everything a download needs.
 */
export type WorkflowInstanceStatus =
	| 'queued'
	| 'running'
	| 'paused'
	| 'errored'
	| 'terminated'
	| 'complete'
	| 'waiting'
	| 'waitingForPause'
	| 'rollingBack'
	| 'unknown';

/** The states a client is shown; a closed set, so the client never switches on a raw workflow string. */
export const EXPORT_STATES = {
	queued: 'queued',
	running: 'running',
	complete: 'complete',
	errored: 'errored'
} as const;
export type ExportState = (typeof EXPORT_STATES)[keyof typeof EXPORT_STATES];

/** The machine-readable code that travels with each state. */
export const EXPORT_CODES = {
	queued: 'export_queued',
	running: 'export_running',
	complete: 'export_complete',
	errored: 'export_errored'
} as const;

/**
 * Map a workflow status onto the client's closed set. Every member of the union is answered: an
 * in-flight state still counts as running, a rolled-back instance is running again (it restarts),
 * and anything the runtime reports that this application does not understand is treated as errored
 * rather than guessed to be complete.
 */
export function mapWorkflowStatus(status: WorkflowInstanceStatus): ExportState {
	switch (status) {
		case 'queued':
			return EXPORT_STATES.queued;
		case 'running':
		case 'paused':
		case 'waiting':
		case 'waitingForPause':
		case 'rollingBack':
			return EXPORT_STATES.running;
		case 'complete':
			return EXPORT_STATES.complete;
		case 'errored':
		case 'terminated':
		case 'unknown':
			return EXPORT_STATES.errored;
	}
}
