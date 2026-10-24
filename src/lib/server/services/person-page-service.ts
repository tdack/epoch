/**
 * Read model for a person's page: everything one screen shows about them, from a handful of
 * bounded reads. The relatives come from the same focus window the tree uses (one generation each
 * way, with siblings and step-families on), so the page and the canvas cannot disagree about who
 * someone's family is.
 */

import { isActionAllowed } from '../auth/authorization';
import type { DbClient } from '../db';
import { NotFoundError } from '../domain/errors';
import { MediaRepository } from '../repositories/media-repository';
import { canDeleteMedia, readableFileIds } from './media-service';
import type { AuthenticatedContext } from '../domain/identity';
import type { EventRow, IndividualRow, MediaRow, PersonNameRow } from '../domain/change-log';
import { eventDateValue } from '../domain/date-columns';
import type { NameType } from '../domain/genealogy-model';
import { sortByBirth } from '../../shared/birth-order';
import type { ParentChildType } from '../../shared/relationship-model';
import { EvidenceRepository } from '../repositories/evidence-repository';
import { NoteRepository } from '../repositories/note-repository';
import { isSubtreeMember } from '../repositories/subtree-membership';
import { visibleAmong } from '../repositories/visibility';
import { NOTE_SUBJECT_KINDS, type NoteDto } from '../../shared/notes';
import {
	GraphWindowRepository,
	type ChangeHistoryRow
} from '../repositories/graph-window-repository';
import { canUndoChange } from '../../shared/change-audit';
import type { TreeRole } from '../../shared/roles';
import { TreeRepository } from '../repositories/tree-repository';
import { UserRepository } from '../repositories/user-repository';
import {
	CONFLICT_KINDS,
	findFactConflicts,
	sortTimeline,
	type FactConflict
} from '../../shared/fact-timeline';
import { FACT_KINDS, factTypeInfo, factLabel } from '../../shared/fact-types';
import { displayNameWith, formatFullName } from '../../shared/name-types';
import { personName } from '../../shared/person-name';
import { partnershipLabels } from '../../shared/partnership-labels';
import { privacyOf } from '../../shared/privacy';
import { isLikelyLiving } from '../domain/living-state';
import { relativesOf } from '../../shared/relatives';
import { isSex } from '../../shared/sex';
import { mergeableUnionIds } from '../../shared/union-merge';
import { widowhoods } from '../../shared/widowhood';
import { loadFocusWindow } from './focus-window';
import { personSummaries } from './person-summaries';
import type {
	ChangeEntryDto,
	FactDto,
	NameDto,
	PartnershipDto,
	PersonPageDto,
	PersonSummaryDto
} from '../../shared/person-page';
import { citationDto, inSubjectOrder } from './evidence-dto';
import { loadNoteDtos, notesOf } from './note-dto';
import { TaskReadService } from './task-read-service';
import { requireTreeScope, type ViewerScope } from './tree-access';

/** How many changes the page lists; the full history is Phase 4's change view. */
export const RECENT_CHANGES_SHOWN = 15;

/** A history row as the page lists it, with whether this viewer may undo it (ADR-068). */
export function changeEntryDto(
	c: ChangeHistoryRow,
	actors: Map<string, string>,
	scope: { role: TreeRole; userId: string }
): ChangeEntryDto {
	const isUndo = c.revertsChangeId !== null;
	return {
		id: c.id,
		kind: c.kind,
		summary: c.summary,
		actorName: actors.get(c.actorId) ?? null,
		createdAt: c.createdAt,
		isUndo,
		isUndone: c.isUndone,
		canUndo: canUndoChange(scope, { ...c, isUndo })
	};
}

/**
 * The note a fact's form shows: its first note written on the fact itself, or the legacy imported
 * description while the fact has no note of its own. The column `events.notes` is not read (ADR-029).
 */
function factNoteText(row: EventRow, noteItems: NoteDto[]): string | null {
	const own = noteItems.find((n) => !n.isShared && !n.isMissing);
	if (own) return own.text;
	return noteItems.length === 0 ? row.description : null;
}

function factDto(
	row: EventRow,
	conflict: FactConflict | null,
	citationCount: number,
	noteItems: NoteDto[]
): FactDto {
	const date = eventDateValue(row);
	const info = factTypeInfo(row.type);
	return {
		...privacyOf(row),
		id: row.id,
		type: row.type,
		label: factLabel(row.type),
		kind: info?.kind ?? FACT_KINDS.EVENT,
		dateText: row.dateRaw,
		sortStart: date.sortStart,
		isApproximate: date.isApproximate,
		place: row.place,
		value: row.value,
		cause: row.cause,
		age: row.age,
		address: row.address,
		classification: row.classification,
		agency: row.agency,
		phone: row.phone,
		email: row.email,
		fax: row.fax,
		web: row.web,
		latitude: row.latitude,
		longitude: row.longitude,
		religion: row.religion,
		retainedLines: row.gedcomExtra ?? [],
		notes: factNoteText(row, noteItems),
		isLegacyNote: noteItems.length === 0 && row.description !== null,
		sortOrder: row.sortOrder,
		version: row.version,
		conflict,
		citationCount,
		noteItems
	};
}

function nameDtos(
	person: IndividualRow,
	rows: PersonNameRow[],
	citationCounts: ReadonlyMap<string, number>,
	notes: ReadonlyMap<string, NoteDto[]>
): NameDto[] {
	if (rows.length === 0) {
		// Editor-created people have no stored name row; their name fields are their only name.
		return [
			{
				...privacyOf(person),
				id: null,
				version: null,
				type: 'birth',
				gedcomType: null,
				givenName: person.givenName,
				surname: person.surname,
				prefix: null,
				suffix: null,
				nickname: null,
				surnamePrefix: null,
				dateText: null,
				unionId: null,
				displayName: personName(person),
				isPreferred: true,
				citationCount: 0,
				notes: []
			}
		];
	}
	return (
		[...rows]
			.sort((a, b) => Number(b.isPreferred) - Number(a.isPreferred) || a.order - b.order)
			// A row the pre-S6 person form left stale reads as the person's own fields, as export does (ADR-013).
			.map((n) =>
				n.isPreferred ? { ...n, givenName: person.givenName, surname: person.surname } : n
			)
			.map((n) => ({
				...privacyOf(n),
				id: n.id,
				version: n.version,
				type: n.type as NameType,
				gedcomType: n.gedcomType,
				givenName: n.givenName,
				surname: n.surname,
				prefix: n.namePrefix,
				suffix: n.nameSuffix,
				nickname: n.nickname,
				surnamePrefix: n.surnamePrefix,
				dateText: n.dateRaw,
				unionId: n.unionId,
				displayName: formatFullName({
					prefix: n.namePrefix,
					givenName: n.givenName,
					surnamePrefix: n.surnamePrefix,
					surname: n.surname,
					suffix: n.nameSuffix
				}),
				isPreferred: n.isPreferred,
				citationCount: citationCounts.get(n.id) ?? 0,
				notes: notesOf(notes, NOTE_SUBJECT_KINDS.NAME, n.id)
			}))
	);
}

export class PersonPageService {
	private now: () => Date;
	private repo: GraphWindowRepository;
	private media: MediaRepository;
	private evidence: EvidenceRepository;
	private notes: NoteRepository;
	private tasks: TaskReadService;
	private users: UserRepository;
	private trees: TreeRepository;

	constructor(
		private db: DbClient,
		now: () => Date = () => new Date()
	) {
		this.now = now;
		this.repo = new GraphWindowRepository(db);
		this.media = new MediaRepository(db);
		this.evidence = new EvidenceRepository(db);
		this.notes = new NoteRepository(db);
		this.tasks = new TaskReadService(db, now);
		this.users = new UserRepository(db);
		this.trees = new TreeRepository(db);
	}

	private requireView(treeId: string, context: AuthenticatedContext): Promise<ViewerScope> {
		return requireTreeScope(this.users, this.trees, treeId, context, 'tree:view', this.now());
	}

	async getPerson(
		treeId: string,
		personId: string,
		context: AuthenticatedContext,
		lensRootId: string | null = null
	): Promise<PersonPageDto> {
		const scope = await this.requireView(treeId, context);

		const window = await loadFocusWindow(
			this.repo,
			treeId,
			personId,
			{
				ancestorDepth: 1,
				descendantDepth: 1,
				shouldIncludeSiblings: true,
				shouldIncludeStepFamilies: true
			},
			scope.isRestricted ? scope : undefined
		);
		const { graph } = window;
		const relatives = relativesOf(graph, personId);

		const [[self], nameRows, factRows, linkedMedia] = await this.repo.run(
			this.repo.individualsIn(treeId, [personId]),
			this.repo.namesOf(treeId, [personId]),
			this.repo.eventsOf(treeId, 'INDIVIDUAL', [personId]),
			this.repo.mediaOf(treeId, [personId])
		);
		if (!self) throw new NotFoundError('Person', personId);
		// A file also linked to someone the viewer cannot see is not shown on this page either.
		const readable = await readableFileIds(
			this.db,
			treeId,
			linkedMedia.map(({ row }) => row.id),
			scope
		);
		const mediaRows = linkedMedia.filter(({ row }) => readable.has(row.id));
		const uploaders = await this.media.uploadersOf(treeId, personId);
		const fileLinks = await this.media.linksOf(
			treeId,
			mediaRows.map(({ row }) => row.id)
		);

		// Evidence: every citation of the person and of what they have, in one batch, then the sources
		// those name. A fact or name that none cites is unsourced.
		const cited = await this.evidence.citationsOfPerson(treeId, personId, scope);
		const sourcesById = new Map(
			(
				await this.evidence.sourcesByIds(
					treeId,
					cited.rows.flatMap((c) => (c.sourceId ? [c.sourceId] : []))
				)
			).map((s) => [s.id, s])
		);
		const citationCounts = new Map<string, number>();
		for (const c of cited.rows)
			citationCounts.set(c.subjectId, (citationCounts.get(c.subjectId) ?? 0) + 1);

		// Notes (ADR-029): on the person, their names and facts, the links they are the child in and the
		// citations shown here. A note is visible when its subject is, and each of these is the viewer's
		// already, except a link whose parent is private.
		const [childLinks] = await this.repo.run(this.repo.linksBy(treeId, 'child', [personId]));
		const seenParents = await visibleAmong(
			this.repo.client,
			treeId,
			[...new Set(childLinks.map((l) => l.row.parentId))],
			scope
		);
		const links = childLinks.map((l) => l.row).filter((l) => seenParents.has(l.parentId));
		const noteRows = await this.notes.attachmentsOf(treeId, {
			[NOTE_SUBJECT_KINDS.PERSON]: [personId],
			[NOTE_SUBJECT_KINDS.NAME]: nameRows.map((n) => n.row.id),
			[NOTE_SUBJECT_KINDS.EVENT]: factRows.map((f) => f.row.id),
			[NOTE_SUBJECT_KINDS.PARENT_CHILD]: links.map((l) => l.id),
			[NOTE_SUBJECT_KINDS.CITATION]: cited.rows.map((c) => c.id)
		});
		const noteItems = await loadNoteDtos(this.notes, treeId, noteRows, scope);

		// Half-siblings and the like are named by the graph only if the window drew them; fetch the rest.
		const wanted = [
			...relatives.parentFamilies.flatMap((f) => f.parents.map((p) => p.personId)),
			...relatives.partnerships.flatMap((p) => [
				...p.partnerIds,
				...p.children.map((c) => c.personId)
			]),
			...relatives.directChildren.map((c) => c.personId),
			...relatives.siblings.full,
			...relatives.siblings.half,
			...relatives.stepParents.map((s) => s.personId),
			...relatives.stepChildren.flatMap((s) => [s.personId, s.viaPartnerId])
		];
		const summaries = await personSummaries(this.repo, treeId, graph, wanted, scope);
		const summary = (id: string): PersonSummaryDto => summaries.get(id)!;

		// ---- Facts ----
		const rows = factRows.sort((a, b) => a.rid - b.rid).map((r) => r.row);
		const timeline = sortTimeline(
			rows.map((row) => ({
				id: row.id,
				type: row.type,
				dateText: row.dateRaw,
				sortStart: eventDateValue(row).sortStart,
				place: row.place,
				value: row.value,
				cause: row.cause,
				age: row.age,
				notes: factNoteText(row, notesOf(noteItems, NOTE_SUBJECT_KINDS.EVENT, row.id)),
				sortOrder: row.sortOrder
			}))
		);
		const conflicts = findFactConflicts(timeline);
		const rowById = new Map(rows.map((row) => [row.id, row]));
		const facts = timeline.map((t) =>
			factDto(
				rowById.get(t.id)!,
				conflicts.get(t.id) ?? null,
				citationCounts.get(t.id) ?? 0,
				notesOf(noteItems, NOTE_SUBJECT_KINDS.EVENT, t.id)
			)
		);
		const birth = facts.find((f) => f.type === 'BIRT') ?? null;
		const death = facts.find((f) => f.type === 'DEAT') ?? null;
		const lifespanParts = [birth?.dateText, death?.dateText];
		const vitals = {
			birth,
			death,
			lifespan: lifespanParts.some(Boolean)
				? `${lifespanParts[0] ?? '?'} – ${lifespanParts[1] ?? ''}`.trim()
				: null,
			hasConflict: [birth, death].some((f) => f?.conflict?.kind === CONFLICT_KINDS.CONFLICT)
		};

		// ---- Partnerships ----
		const labels = partnershipLabels(graph.unions);
		const mergeable = mergeableUnionIds(graph.unions);
		const deceased = new Set(graph.people.filter((p) => p.isDeceased).map((p) => p.id));
		const widowed = new Set(
			widowhoods(
				graph.unions.map((u) => ({ id: u.id, status: u.status, partnerIds: u.partnerIds })),
				deceased
			)
				.filter((w) => w.widowId === personId)
				.map((w) => w.unionId)
		);
		const unionById = new Map(graph.unions.map((u) => [u.id, u]));
		const childEntry = (c: { personId: string; types: ParentChildType[] }) => ({
			person: summary(c.personId),
			types: c.types
		});
		// Oldest first, by the key the viewer's own masked rows gave: a hidden child has none, so
		// the order says nothing about their birth beyond "undated".
		const inBirthOrder = (children: Array<{ personId: string; types: ParentChildType[] }>) =>
			sortByBirth(children.map(childEntry), (c) => ({
				birthSort: c.person.birthSort,
				name: c.person.displayName
			}));

		const partnerships: PartnershipDto[] = relatives.partnerships.map((p) => {
			const union = unionById.get(p.unionId)!;
			return {
				...privacyOf(union),
				unionId: p.unionId,
				version: union.version ?? 0,
				status: p.status,
				label: labels.get(p.unionId) ?? null,
				isWidowed: widowed.has(p.unionId),
				isMergeable: mergeable.has(p.unionId),
				partners: p.partnerIds.map(summary),
				children: inBirthOrder(p.children),
				events: union.events ?? []
			};
		});

		// ---- History ----
		// A change's summary is prose naming everyone it touched ("Added Liv as a child of Gran"), so a
		// restricted viewer gets no history rather than text that could name a private person.
		const recent = scope.isRestricted
			? []
			: await this.repo.recentChanges(
					treeId,
					[personId, ...rows.map((r) => r.id)],
					RECENT_CHANGES_SHOWN
				);
		const actors = await this.repo.actorNames(
			treeId,
			recent.map((c) => c.actorId)
		);

		return {
			...privacyOf(self.row),
			...(lensRootId === null
				? {}
				: { isInSubtree: await isSubtreeMember(this.repo.client, treeId, lensRootId, personId) }),
			privacy: scope.isRestricted
				? null
				: {
						setting: self.row.privacy,
						isLikelyLiving: isLikelyLiving(
							rows.map((r) => ({ type: r.type, dateSortEnd: r.dateSortEnd })),
							scope.cutoff
						)
					},
			person: {
				id: self.row.id,
				xrefId: self.row.xrefId,
				version: self.row.version,
				sex: isSex(self.row.sex) ? self.row.sex : 'U',
				givenName: self.row.givenName,
				surname: self.row.surname,
				displayName: displayNameWith(
					self.row,
					nameRows.map((n) => n.row)
				),
				isDeceased: death !== null
			},
			names: nameDtos(
				self.row,
				nameRows.map((n) => n.row),
				citationCounts,
				noteItems
			),
			vitals,
			facts,
			parentFamilies: relatives.parentFamilies.map((f) => ({
				unionId: f.unionId,
				label: f.unionId ? (labels.get(f.unionId) ?? null) : null,
				parents: f.parents.map((p) => ({
					person: summary(p.personId),
					type: p.type,
					linkId: p.linkId ?? null
				}))
			})),
			partnerships,
			directChildren: inBirthOrder(relatives.directChildren),
			siblings: {
				full: relatives.siblings.full.map(summary),
				half: relatives.siblings.half.map(summary)
			},
			stepParents: relatives.stepParents.map((s) => ({
				person: summary(s.personId),
				unionId: s.unionId
			})),
			stepChildren: relatives.stepChildren.map((s) => ({
				person: summary(s.personId),
				via: summary(s.viaPartnerId),
				unionId: s.unionId
			})),
			media: mediaRows.map(({ row }: { row: MediaRow }) => ({
				...privacyOf(row),
				id: row.id,
				title: row.title,
				mimeType: row.mimeType,
				r2ObjectKey: row.r2ObjectKey,
				version: row.version,
				isShared: (fileLinks.get(row.id)?.length ?? 0) > 1,
				canUnlink: isActionAllowed(scope.role, 'media:manage'),
				canDelete: canDeleteMedia(scope, uploaders.get(row.id) ?? null)
			})),
			notes: notesOf(noteItems, NOTE_SUBJECT_KINDS.PERSON, personId),
			linkNotes: links.flatMap((l) => {
				const own = notesOf(noteItems, NOTE_SUBJECT_KINDS.PARENT_CHILD, l.id);
				return own.length > 0
					? [
							{
								id: l.id,
								label: `${summaries.get(l.parentId)?.displayName ?? 'A parent'} as parent`,
								notes: own
							}
						]
					: [];
			}),
			tasks: await this.tasks.tasksOfPerson(
				treeId,
				personId,
				factRows.map((f) => f.row.id),
				scope
			),
			evidence: {
				citations: inSubjectOrder(cited.rows).map((c) =>
					citationDto(c, sourcesById, notesOf(noteItems, NOTE_SUBJECT_KINDS.CITATION, c.id))
				),
				links: [...cited.linkParents].map(([id, parentId]) => ({
					id,
					label: `${summaries.get(parentId)?.displayName ?? 'A parent'} as parent`
				}))
			},
			changes: {
				recent: recent.map((c) => changeEntryDto(c, actors, scope)),
				createdAt: self.row.createdAt,
				updatedAt: self.row.updatedAt
			},
			graph
		};
	}
}
