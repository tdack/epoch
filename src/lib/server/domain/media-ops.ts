/**
 * Row operations for media files (Phase 2): rename, attach and detach. Move is an attach to a
 * different record, not a command of its own, so one rule covers both. Delete is not here: it
 * removes the object as well as the row, and is not an undoable change (see `MediaService.delete`).
 *
 * The bytes are never touched by these ops. Ownership is `entity_id` alone, so every op is a row
 * update, and undo is the same update reversed.
 */

import type { MediaRow, RowOp, TreeRows } from './change-log';
import { ConcurrencyConflictError, NotFoundError, ValidationError } from './errors';
import { MAX_MEDIA_TITLE_LENGTH } from '../../shared/media';

export type MediaCommand =
	| { kind: 'rename_media'; mediaId: string; title: string; expectedVersion?: number }
	| {
			kind: 'attach_media';
			mediaId: string;
			/** A person, a union or a source in the same tree; a file on a record is attached to it. */
			entityId: string;
			expectedVersion?: number;
	  }
	| { kind: 'detach_media'; mediaId: string; expectedVersion?: number };

export interface MediaContext {
	treeId: string;
	/** Epoch milliseconds, stamped on the row written. */
	now: number;
}

function requireMedia(rows: TreeRows, id: string): MediaRow {
	const media = rows.mediaItems.find((m) => m.id === id);
	if (!media) throw new NotFoundError('File', id);
	return media;
}

function checkVersion(media: MediaRow, expected: number | undefined): void {
	if (expected === undefined || media.version === expected) return;
	throw new ConcurrencyConflictError(
		`This file was changed by someone else (you had version ${expected}, it is now ${media.version}).`,
		{
			reason: 'STALE_VERSION',
			entity: 'media',
			id: media.id,
			expectedVersion: expected,
			currentVersion: media.version,
			current: { title: media.title, entityId: media.entityId }
		}
	);
}

function touch(media: MediaRow, ctx: Pick<MediaContext, 'now'>): MediaRow {
	return { ...media, version: media.version + 1, updatedAt: ctx.now };
}

function update(before: MediaRow, after: MediaRow): RowOp[] {
	return [{ table: 'media_items', id: before.id, before, after }];
}

/** A title is required, trimmed and bounded; the bound is refused rather than cut silently. */
function validateMediaTitle(title: string): string {
	const trimmed = title.trim();
	if (!trimmed) throw new ValidationError('A file needs a name.');
	if (trimmed.length > MAX_MEDIA_TITLE_LENGTH)
		throw new ValidationError(`A file name is at most ${MAX_MEDIA_TITLE_LENGTH} characters.`);
	return trimmed;
}

/**
 * Ops for one media command. A command that would change nothing returns no ops, so it is logged
 * as nothing rather than as an edit that did not happen.
 */
export function buildMediaOps(rows: TreeRows, command: MediaCommand, ctx: MediaContext): RowOp[] {
	const before = requireMedia(rows, command.mediaId);
	checkVersion(before, command.expectedVersion);
	switch (command.kind) {
		case 'rename_media': {
			const title = validateMediaTitle(command.title);
			if (title === before.title) return [];
			return update(before, touch({ ...before, title }, ctx));
		}
		case 'attach_media': {
			const isKnownRecord =
				rows.individuals.some((p) => p.id === command.entityId) ||
				rows.unions.some((u) => u.id === command.entityId) ||
				rows.sources.some((s) => s.id === command.entityId);
			if (!isKnownRecord) throw new NotFoundError('Record for the file', command.entityId);
			if (before.entityId === command.entityId) return [];
			return update(before, touch({ ...before, entityId: command.entityId }, ctx));
		}
		case 'detach_media': {
			if (before.entityId === null) return [];
			return update(before, touch({ ...before, entityId: null }, ctx));
		}
	}
}
