/**
 * Row operations for media files: rename, link and unlink. A file can hang off many records, so a
 * move is an unlink and a link, not a command of its own. Delete is not here: it removes the
 * object as well as the row, and is not an undoable change (see `MediaService.delete`).
 *
 * The bytes are never touched by these ops. A link is a `media_links` row, so undo is the same
 * change reversed. Each op also bumps the file's version, which is what a stale editor conflicts on.
 */

import type { MediaRow, RowOp, TreeRows } from './change-log';
import { ConcurrencyConflictError, NotFoundError, ValidationError } from './errors';
import { MAX_MEDIA_TITLE_LENGTH, mediaLinkId } from '../../shared/media';

export type MediaCommand =
	| { kind: 'rename_media'; mediaId: string; title: string; expectedVersion?: number }
	| {
			kind: 'link_media';
			mediaId: string;
			/** A person, a union or a source in the same tree. */
			entityId: string;
			expectedVersion?: number;
	  }
	| { kind: 'unlink_media'; mediaId: string; entityId: string; expectedVersion?: number };

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
			current: { title: media.title }
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
		case 'link_media': {
			const isKnownRecord =
				rows.individuals.some((p) => p.id === command.entityId) ||
				rows.unions.some((u) => u.id === command.entityId) ||
				rows.sources.some((s) => s.id === command.entityId);
			if (!isKnownRecord) throw new NotFoundError('Record for the file', command.entityId);
			const id = mediaLinkId(before.id, command.entityId);
			if (rows.mediaLinks.some((l) => l.id === id)) return [];
			return [
				...update(before, touch(before, ctx)),
				{
					table: 'media_links',
					id,
					before: null,
					after: {
						id,
						treeId: ctx.treeId,
						mediaId: before.id,
						entityId: command.entityId,
						createdAt: ctx.now
					}
				}
			];
		}
		case 'unlink_media': {
			const link = rows.mediaLinks.find((l) => l.id === mediaLinkId(before.id, command.entityId));
			if (!link) return [];
			return [
				...update(before, touch(before, ctx)),
				{ table: 'media_links', id: link.id, before: link, after: null }
			];
		}
	}
}
