/**
 * A person's media section, built from the files of every object they are linked to, the pointers
 * themselves, and their facts (ADR-082). Pure, so the ordering rules are tested without a database.
 */

import { isActionAllowed } from '../auth/authorization';
import type { EventRow, MediaLinkRow, MediaRow } from '../domain/change-log';
import { factLabel } from '../../shared/fact-types';
import { isUnresolvedFile, objectIdOf } from '../../shared/media';
import type { MediaFileDto, PersonMediaDto } from '../../shared/person-page';
import { privacyOf } from '../../shared/privacy';
import { canDeleteMedia } from './media-service';
import type { ViewerScope } from './tree-access';

export interface PersonMediaInput {
	/** Every readable file of every linked object, in any order. */
	files: MediaRow[];
	/** The person's own pointers, each with its row position for a stable tiebreak. */
	links: Array<{ rid: number; row: MediaLinkRow }>;
	/** The person's facts, in display order; a fact's pointers follow the record's own. */
	facts: EventRow[];
	/** Version by object id; an object not yet backfilled is absent and its first file stands for it. */
	objects: ReadonlyMap<string, { version: number }>;
	/** Every record each object is linked to, to tell a shared file from one only this person has. */
	linkedRecords: ReadonlyMap<string, string[]>;
	/** Uploader by file id. */
	uploaders: ReadonlyMap<string, string | null>;
	scope: Pick<ViewerScope, 'role' | 'userId'>;
}

function fileDto(file: MediaRow): MediaFileDto {
	const isUnresolved = isUnresolvedFile(file);
	return {
		id: file.id,
		title: file.title,
		version: file.version,
		mimeType: file.mimeType,
		// The placeholder key of an unresolved file names no object; it never leaves the server.
		r2ObjectKey: isUnresolved ? null : file.r2ObjectKey,
		isUnresolved,
		gedcomPath: file.gedcomPath
	};
}

/** The files of one object in their own order: `sort_order` (null as 0), then id. */
function inFileOrder(files: MediaRow[]): MediaRow[] {
	return [...files].sort(
		(a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || (a.id < b.id ? -1 : 1)
	);
}

/**
 * One entry per pointer, record-level pointers first and then each fact's in the fact order, each
 * group by `sort_order` (null as 0) and then by row position. Move up and down edit one group, so a
 * group has to be contiguous and in the same order the server will write back.
 */
export function personMediaEntries(input: PersonMediaInput): PersonMediaDto[] {
	const byObject = new Map<string, MediaRow[]>();
	for (const file of input.files) {
		const id = objectIdOf(file);
		byObject.set(id, [...(byObject.get(id) ?? []), file]);
	}
	const factRank = new Map(input.facts.map((fact, index) => [fact.id, index]));
	const factById = new Map(input.facts.map((fact) => [fact.id, fact]));
	const groupOf = (link: MediaLinkRow) =>
		link.factId === null ? -1 : (factRank.get(link.factId) ?? input.facts.length);

	const ordered = input.links
		.filter(({ row }) => byObject.has(row.mediaId))
		.sort(
			(a, b) =>
				groupOf(a.row) - groupOf(b.row) ||
				(a.row.sortOrder ?? 0) - (b.row.sortOrder ?? 0) ||
				a.rid - b.rid
		);

	return ordered.map(({ row: link }) => {
		const [first, ...rest] = inFileOrder(byObject.get(link.mediaId)!);
		const fact = link.factId ? factById.get(link.factId) : undefined;
		return {
			...privacyOf(first!),
			...fileDto(first!),
			objectId: link.mediaId,
			objectVersion: input.objects.get(link.mediaId)?.version ?? first!.version,
			linkTitle: link.title,
			factId: link.factId,
			factLabel: fact ? factLabel(fact.type) : null,
			extraFiles: rest.map(fileDto),
			isShared: (input.linkedRecords.get(link.mediaId)?.length ?? 0) > 1,
			canUnlink: isActionAllowed(input.scope.role, 'media:manage'),
			canDelete: canDeleteMedia(input.scope, input.uploaders.get(first!.id) ?? null)
		};
	});
}
