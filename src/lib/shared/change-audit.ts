/**
 * The audit log as the screens read it (ADR-068), and the one rule for who may undo a change. The
 * server decides again when asked to undo; this is computed there too and sent as `canUndo`, so a
 * screen never repeats the rule.
 */

import type { RecordChange } from './impact';
import { isManagerOrAbove, type TreeRole } from './roles';

/** Entries per page of the audit log. */
export const AUDIT_PAGE_SIZE = 25;

/** A record a change wrote; only a person or partnership that still exists has a page to link to. */
export interface AuditRecordDto extends RecordChange {
	isLinkable: boolean;
}

interface AuditEntryDto {
	id: string;
	seq: number;
	kind: string;
	summary: string;
	actorName: string | null;
	/** Epoch milliseconds. */
	createdAt: number;
	/** This entry is itself an undo of an earlier change. */
	isUndo: boolean;
	isUndone: boolean;
	undoneByName: string | null;
	undoneAt: number | null;
	canUndo: boolean;
	records: AuditRecordDto[];
}

export interface AuditPageDto {
	entries: AuditEntryDto[];
	/** The page shown, 1-based, after an out-of-range request was brought back into range. */
	page: number;
	pageCount: number;
	/** The zone the From and To days were read in: the reader's, or UTC when none was sent or it is unknown. */
	timeZone: string;
	/** Entries matching the filters, across all pages. */
	total: number;
	/** Everyone who has made a change in the tree, for the actor filter. */
	actors: Array<{ id: string; name: string }>;
}

/** The filters the address carries; a day is `YYYY-MM-DD` in the zone `tz` names (an IANA name, or null for UTC). */
export interface AuditFilters {
	recordId: string | null;
	actorId: string | null;
	from: string | null;
	to: string | null;
	tz: string | null;
}

/**
 * Anyone with edit rights may undo their own change; a manager or owner may also undo someone
 * else's. An undo row, a row with no inverse and a change already undone cannot be undone.
 */
export function canUndoChange(
	viewer: { role: TreeRole; userId: string },
	change: { actorId: string; isUndo: boolean; isUndone: boolean; hasInverse: boolean }
): boolean {
	if (change.isUndo || change.isUndone || !change.hasInverse) return false;
	return change.actorId === viewer.userId || isManagerOrAbove(viewer.role);
}
