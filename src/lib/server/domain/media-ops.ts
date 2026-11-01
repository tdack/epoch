/**
 * Row operations for media: rename a file, link and unlink an object, edit a link, reorder an
 * object's pointers under one host, and set an object's privacy (ADR-082). A file can hang off many
 * records, so a move is an unlink and a link, not a command of its own. Delete is not here: it
 * removes the bytes as well as the rows, and is not an undoable change (see `MediaService.delete`).
 *
 * `mediaId` on a link op names an object. For the whole expand phase an object's id is its first
 * file's id, and a file written before the backfill has no object row at all, so a missing object
 * row falls back to the file's own (`objectIdOf`). The bytes are never touched by these ops.
 */

import type { MediaLinkRow, MediaObjectRow, MediaRow, RowOp, TreeRows } from './change-log';
import { ConcurrencyConflictError, NotFoundError, ValidationError } from './errors';
import {
	MAX_MEDIA_TITLE_LENGTH,
	mediaLinkId,
	objectIdOf,
	type MediaCrop
} from '../../shared/media';
import type { PersonPrivacy } from '../../shared/privacy';
import { PERSON_PRIVACY_VALUES } from '../../shared/privacy';

export type MediaCommand =
	| { kind: 'rename_media'; mediaId: string; title: string; expectedVersion?: number }
	| {
			kind: 'link_media';
			/** An object (before the contract migrations, its first file's id). */
			mediaId: string;
			/** A person, a union or a source in the same tree. */
			entityId: string;
			/** The fact the pointer sits under; `entityId` stays the fact's person or partnership. */
			factId?: string | null;
			sortOrder?: number | null;
			crop?: MediaCrop | null;
			title?: string | null;
			expectedVersion?: number;
	  }
	| {
			kind: 'unlink_media';
			mediaId: string;
			entityId: string;
			factId?: string | null;
			expectedVersion?: number;
	  }
	| {
			kind: 'update_media_link';
			mediaId: string;
			entityId: string;
			factId?: string | null;
			/** Only the keys present are changed; null clears. */
			title?: string | null;
			crop?: MediaCrop | null;
			sortOrder?: number | null;
			expectedVersion?: number;
	  }
	| {
			kind: 'reorder_media_links';
			/** The host: a person, union or source, and the fact when the pointers sit under one. */
			entityId: string;
			factId?: string | null;
			/** Every object linked there, in the new order. */
			orderedMediaIds: string[];
	  }
	| {
			kind: 'update_media_object';
			mediaId: string;
			privacy: PersonPrivacy;
			expectedVersion?: number;
	  };

export interface MediaContext {
	treeId: string;
	/** Epoch milliseconds, stamped on the row written. */
	now: number;
}

/** What a media command is about: the object row, or the file that stands for it before the backfill. */
type Target = { object: MediaObjectRow; file: null } | { object: null; file: MediaRow };

function targetId(target: Target): string {
	return target.object ? target.object.id : target.file.id;
}

function requireFile(rows: TreeRows, id: string): MediaRow {
	const media = rows.mediaItems.find((m) => m.id === id);
	if (!media) throw new NotFoundError('File', id);
	return media;
}

function requireTarget(rows: TreeRows, mediaId: string): Target {
	const object = rows.mediaObjects.find((o) => o.id === mediaId);
	if (object) return { object, file: null };
	// Not backfilled yet: the object is the file with this id.
	return { object: null, file: requireFile(rows, mediaId) };
}

function conflict(
	entity: 'media' | 'media_object',
	id: string,
	expected: number,
	current: number,
	snapshot: Record<string, unknown>
): ConcurrencyConflictError {
	return new ConcurrencyConflictError(
		`This file was changed by someone else (you had version ${expected}, it is now ${current}).`,
		{
			reason: 'STALE_VERSION',
			entity,
			id,
			expectedVersion: expected,
			currentVersion: current,
			current: snapshot
		}
	);
}

function checkFileVersion(media: MediaRow, expected: number | undefined): void {
	if (expected === undefined || media.version === expected) return;
	throw conflict('media', media.id, expected, media.version, { title: media.title });
}

/** The link ops and `update_media_object` guard the object's version; a file not yet backfilled guards its own. */
function checkTargetVersion(target: Target, expected: number | undefined): void {
	if (expected === undefined) return;
	if (target.object) {
		if (target.object.version === expected) return;
		throw conflict('media_object', target.object.id, expected, target.object.version, {
			privacy: target.object.privacy
		});
	}
	checkFileVersion(target.file, expected);
}

function touch<T extends { version: number; updatedAt: number | null }>(
	row: T,
	ctx: Pick<MediaContext, 'now'>
): T {
	return { ...row, version: row.version + 1, updatedAt: ctx.now };
}

function updateFile(before: MediaRow, after: MediaRow): RowOp[] {
	return [{ table: 'media_items', id: before.id, before, after }];
}

/** Bumps what a link edit changed: the object, or the file standing for it. The bump is what a stale editor conflicts on. */
function bumpTarget(target: Target, ctx: Pick<MediaContext, 'now'>): RowOp[] {
	if (target.object)
		return [
			{
				table: 'media_object',
				id: target.object.id,
				before: target.object,
				after: touch(target.object, ctx)
			}
		];
	return updateFile(target.file, touch(target.file, ctx));
}

/** A title is required, trimmed and bounded; the bound is refused rather than cut silently. */
function validateMediaTitle(title: string): string {
	const trimmed = title.trim();
	if (!trimmed) throw new ValidationError('A file needs a name.');
	if (trimmed.length > MAX_MEDIA_TITLE_LENGTH)
		throw new ValidationError(`A file name is at most ${MAX_MEDIA_TITLE_LENGTH} characters.`);
	return trimmed;
}

/** A pointer's own title: blank clears it, since the file's title is then used. */
function normalizeLinkTitle(title: string | null | undefined): string | null {
	const trimmed = title?.trim() ?? '';
	if (trimmed.length > MAX_MEDIA_TITLE_LENGTH)
		throw new ValidationError(`A title is at most ${MAX_MEDIA_TITLE_LENGTH} characters.`);
	return trimmed === '' ? null : trimmed;
}

/** A crop is four whole pixel counts, with a box that has some area. */
function validateCrop(crop: MediaCrop): MediaCrop {
	const parts = [crop.top, crop.left, crop.height, crop.width];
	if (!parts.every((n) => Number.isInteger(n) && n >= 0))
		throw new ValidationError('A crop is four whole numbers of pixels.');
	if (crop.height < 1 || crop.width < 1)
		throw new ValidationError('A crop needs a height and a width of at least 1 pixel.');
	return crop;
}

function validateSortOrder(sortOrder: number | null | undefined): number | null {
	if (sortOrder === undefined || sortOrder === null) return null;
	if (!Number.isInteger(sortOrder) || sortOrder < 0)
		throw new ValidationError('A position is a whole number from 0.');
	return sortOrder;
}

function cropColumns(crop: MediaCrop | null) {
	return {
		cropTop: crop?.top ?? null,
		cropLeft: crop?.left ?? null,
		cropHeight: crop?.height ?? null,
		cropWidth: crop?.width ?? null
	};
}

/** A link's crop as a value, or null when it has none. */
export function cropOf(
	link: Pick<MediaLinkRow, 'cropTop' | 'cropLeft' | 'cropHeight' | 'cropWidth'>
): MediaCrop | null {
	const { cropTop, cropLeft, cropHeight, cropWidth } = link;
	if (cropTop === null || cropLeft === null || cropHeight === null || cropWidth === null)
		return null;
	return { top: cropTop, left: cropLeft, height: cropHeight, width: cropWidth };
}

/** Throws unless the host is a person, union or source, and the fact (if any) belongs to it. */
function requireHost(rows: TreeRows, entityId: string, factId: string | null | undefined): void {
	const isPerson = rows.individuals.some((p) => p.id === entityId);
	const isUnion = rows.unions.some((u) => u.id === entityId);
	const isSource = rows.sources.some((s) => s.id === entityId);
	if (!isPerson && !isUnion && !isSource) throw new NotFoundError('Record for the file', entityId);
	if (!factId) return;
	const fact = rows.events.find((e) => e.id === factId);
	if (!fact) throw new NotFoundError('Fact for the file', factId);
	// A fact keeps its owner in `entity_id`, so the privacy rule and the merges find the link unchanged.
	const isOwner = fact.entityId === entityId;
	const isKindRight = fact.entityType === 'INDIVIDUAL' ? isPerson : isUnion;
	if (!isOwner || !isKindRight)
		throw new ValidationError('That fact does not belong to the record the file is linked to.');
}

function findLink(
	rows: TreeRows,
	objectId: string,
	entityId: string,
	factId: string | null | undefined
): MediaLinkRow | undefined {
	const id = mediaLinkId(objectId, entityId, factId);
	return rows.mediaLinks.find((l) => l.id === id);
}

const PRIVACY_CHOICES: readonly string[] = PERSON_PRIVACY_VALUES;

/**
 * Ops for one media command. A command that would change nothing returns no ops, so it is logged
 * as nothing rather than as an edit that did not happen.
 */
export function buildMediaOps(rows: TreeRows, command: MediaCommand, ctx: MediaContext): RowOp[] {
	switch (command.kind) {
		case 'rename_media': {
			const before = requireFile(rows, command.mediaId);
			checkFileVersion(before, command.expectedVersion);
			const title = validateMediaTitle(command.title);
			if (title === before.title) return [];
			return updateFile(before, touch({ ...before, title }, ctx));
		}
		case 'link_media': {
			const target = requireTarget(rows, command.mediaId);
			checkTargetVersion(target, command.expectedVersion);
			requireHost(rows, command.entityId, command.factId);
			const objectId = targetId(target);
			const id = mediaLinkId(objectId, command.entityId, command.factId);
			if (rows.mediaLinks.some((l) => l.id === id)) return [];
			return [
				...bumpTarget(target, ctx),
				{
					table: 'media_links',
					id,
					before: null,
					after: {
						id,
						treeId: ctx.treeId,
						mediaId: objectId,
						entityId: command.entityId,
						factId: command.factId || null,
						// Null, not 0: null already means 0, and a default here would differ from an old image.
						sortOrder: validateSortOrder(command.sortOrder),
						...cropColumns(command.crop ? validateCrop(command.crop) : null),
						title: normalizeLinkTitle(command.title),
						gedcomExtra: null,
						createdAt: ctx.now
					}
				}
			];
		}
		case 'unlink_media': {
			const target = requireTarget(rows, command.mediaId);
			checkTargetVersion(target, command.expectedVersion);
			const link = findLink(rows, targetId(target), command.entityId, command.factId);
			if (!link) return [];
			return [
				...bumpTarget(target, ctx),
				{ table: 'media_links', id: link.id, before: link, after: null }
			];
		}
		case 'update_media_link': {
			const target = requireTarget(rows, command.mediaId);
			checkTargetVersion(target, command.expectedVersion);
			const link = findLink(rows, targetId(target), command.entityId, command.factId);
			if (!link)
				throw new NotFoundError(
					'Link',
					mediaLinkId(command.mediaId, command.entityId, command.factId)
				);
			let after: MediaLinkRow = link;
			if (command.title !== undefined)
				after = { ...after, title: normalizeLinkTitle(command.title) };
			if (command.crop !== undefined)
				after = { ...after, ...cropColumns(command.crop ? validateCrop(command.crop) : null) };
			if (command.sortOrder !== undefined)
				after = { ...after, sortOrder: validateSortOrder(command.sortOrder) };
			if (JSON.stringify(after) === JSON.stringify(link)) return [];
			return [
				...bumpTarget(target, ctx),
				{ table: 'media_links', id: link.id, before: link, after }
			];
		}
		case 'reorder_media_links': {
			requireHost(rows, command.entityId, command.factId);
			const own = rows.mediaLinks.filter(
				(l) => l.entityId === command.entityId && (l.factId ?? null) === (command.factId || null)
			);
			const ids = command.orderedMediaIds;
			// A set that misses or adds an object is a conflict (someone linked or unlinked meanwhile), as ADR-076 has it.
			if (
				new Set(ids).size !== ids.length ||
				ids.length !== own.length ||
				!own.every((l) => ids.includes(l.mediaId))
			)
				throw new ValidationError('The new order must list each file of this record once.');
			const ops: RowOp[] = [];
			ids.forEach((mediaId, index) => {
				const link = own.find((l) => l.mediaId === mediaId)!;
				// Null already means 0, so a link that is first and unset is left alone.
				if ((link.sortOrder ?? 0) !== index)
					ops.push({
						table: 'media_links',
						id: link.id,
						before: link,
						after: { ...link, sortOrder: index }
					});
			});
			return ops;
		}
		case 'update_media_object': {
			const target = requireTarget(rows, command.mediaId);
			if (!target.object) throw new NotFoundError('File record', command.mediaId);
			checkTargetVersion(target, command.expectedVersion);
			if (!PRIVACY_CHOICES.includes(command.privacy))
				throw new ValidationError('That is not a privacy setting.');
			if (target.object.privacy === command.privacy) return [];
			return [
				{
					table: 'media_object',
					id: target.object.id,
					before: target.object,
					after: touch({ ...target.object, privacy: command.privacy }, ctx)
				}
			];
		}
	}
}

/**
 * Deletes for the file links under every fact these ops delete, so no command that removes a fact
 * (a fact delete, a merge that drops a duplicate) has to remember its pointers, and an undo restores
 * them with it. The object and its files stay; if that was the last link the object is detached.
 * A link an op already handles (a person delete, a merge moving it) is left to that op.
 */
export function mediaLinkCascadeOps(rows: TreeRows, ops: RowOp[]): RowOp[] {
	if (!rows.mediaLinks.some((l) => l.factId)) return [];
	const gone = new Set(
		ops.filter((op) => op.table === 'events' && op.after === null).map((op) => op.id)
	);
	if (gone.size === 0) return [];
	const handled = new Set(ops.filter((op) => op.table === 'media_links').map((op) => op.id));
	return rows.mediaLinks
		.filter((l) => l.factId && gone.has(l.factId) && !handled.has(l.id))
		.map((l): RowOp => ({ table: 'media_links', id: l.id, before: l, after: null }));
}
