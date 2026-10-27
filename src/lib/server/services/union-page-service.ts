/**
 * Read model for a partnership's page: who is in it, what happened to it, who its children are, a
 * chronology that puts its events beside the partners' and children's births and deaths, and the
 * warnings that chronology and the records raise. Bounded like the person page: the partnership,
 * its partners and its children, plus the focus window around the first partner for the dialogs.
 */

import type { DbClient } from '../db';
import { NotFoundError } from '../domain/errors';
import type { AuthenticatedContext } from '../domain/identity';
import { eventDateValue } from '../domain/date-columns';
import type { ParentChildType, UnionStatus } from '../../shared/relationship-model';
import type { RelationshipGraph } from '../../shared/relationship-graph';
import { eventLabel } from '../domain/tree-labels';
import { EvidenceRepository } from '../repositories/evidence-repository';
import { NoteRepository } from '../repositories/note-repository';
import { NOTE_SUBJECT_KINDS, type NoteDto } from '../../shared/notes';
import { GraphWindowRepository } from '../repositories/graph-window-repository';
import { TreeRepository } from '../repositories/tree-repository';
import { UserRepository } from '../repositories/user-repository';
import { visibleAmong } from '../repositories/visibility';
import { partnershipLabels } from '../../shared/partnership-labels';
import { privacyOf } from '../../shared/privacy';
import { partnerSetKey } from '../../shared/union-merge';
import { isUnionEventType } from '../../shared/union-events';
import { boundsOf, unionWarnings } from '../../shared/union-warnings';
import { citationDto, inSubjectOrder } from './evidence-dto';
import { loadNoteDtos, notesOf } from './note-dto';
import { loadFocusWindow } from './focus-window';
import { changeEntryDto, RECENT_CHANGES_SHOWN } from './person-page-service';
import { personSummaries } from './person-summaries';
import { sortByBirth } from '../../shared/birth-order';
import { type PersonSummaryDto } from '../../shared/person-page';
import { requireTreeScope, type ViewerScope } from './tree-access';
import {
	type UnionPageDto,
	type GroupSheetDto,
	type GroupSheetVitalDto,
	type UnionEventDto,
	type UnionChildDto,
	type ChronologyKind,
	type ChronologyEntryDto,
	CHRONOLOGY_KINDS
} from '../../shared/union-page';

/** The facts a family group sheet gives each person, in the order it gives them. */
const GROUP_SHEET_VITALS: readonly string[] = ['BIRT', 'CHR', 'BAPM', 'DEAT', 'BURI', 'CREM'];

const EMPTY_GRAPH: RelationshipGraph = { people: [], unions: [], parentChild: [] };

export class UnionPageService {
	private repo: GraphWindowRepository;
	private evidence: EvidenceRepository;
	private notes: NoteRepository;
	private users: UserRepository;
	private trees: TreeRepository;

	constructor(
		db: DbClient,
		private now: () => Date = () => new Date()
	) {
		this.repo = new GraphWindowRepository(db);
		this.evidence = new EvidenceRepository(db);
		this.notes = new NoteRepository(db);
		this.users = new UserRepository(db);
		this.trees = new TreeRepository(db);
	}

	private requireView(treeId: string, context: AuthenticatedContext): Promise<ViewerScope> {
		return requireTreeScope(this.users, this.trees, treeId, context, 'tree:view', this.now());
	}

	async getUnion(
		treeId: string,
		unionId: string,
		context: AuthenticatedContext
	): Promise<UnionPageDto> {
		return this.unionPage(treeId, unionId, await this.requireView(treeId, context));
	}

	/**
	 * The partnership page plus what a family group sheet adds: each shown person's vital facts with
	 * places, the partners' own parents and the children's partners. Built on the page, so every
	 * person it leaves out or masks stays left out or masked here.
	 */
	async getGroupSheet(
		treeId: string,
		unionId: string,
		context: AuthenticatedContext
	): Promise<GroupSheetDto> {
		const scope = await this.requireView(treeId, context);
		const page = await this.unionPage(treeId, unionId, scope);
		const shownIds = (people: PersonSummaryDto[]) =>
			people.filter((p) => !p.isPrivate).map((p) => p.id);
		const partnerIds = shownIds(page.partners);
		const childIds = shownIds(page.children.map((c) => c.person));

		const [vitalRows, parentLinks, childPartnerRows] = await this.repo.run(
			this.repo.eventsOf(treeId, 'INDIVIDUAL', [...partnerIds, ...childIds], GROUP_SHEET_VITALS),
			this.repo.linksBy(treeId, 'child', partnerIds),
			this.repo.partnerRowsOfPersons(treeId, childIds)
		);
		const childUnionIds = [...new Set(childPartnerRows.map((r) => r.row.unionId))];
		const [coPartnerRows] = await this.repo.run(
			this.repo.partnerRowsOfUnions(treeId, childUnionIds)
		);
		const parentIds = [...new Set(parentLinks.map((l) => l.row.parentId))];
		const coPartnerIds = [...new Set(coPartnerRows.map((r) => r.row.personId))].filter(
			(id) => !childIds.includes(id)
		);
		const people = await personSummaries(
			this.repo,
			treeId,
			undefined,
			[...parentIds, ...coPartnerIds],
			scope
		);
		// Same rule as the page's children: a private relative is a placeholder or is left out.
		const isListed = (id: string) => !people.get(id)?.isPrivate || scope.shouldShowPrivateStructure;

		const vitalsOf = (personId: string): GroupSheetVitalDto[] =>
			vitalRows
				.filter((e) => e.row.entityId === personId)
				.sort(
					(a, b) =>
						GROUP_SHEET_VITALS.indexOf(a.row.type) - GROUP_SHEET_VITALS.indexOf(b.row.type) ||
						a.rid - b.rid
				)
				.map(({ row }) => ({
					type: row.type,
					label: eventLabel(row.type),
					dateText: row.dateRaw,
					place: row.place
				}));

		const parents = Object.fromEntries(
			partnerIds.map((id) => [
				id,
				parentLinks
					.filter((l) => l.row.childId === id && isListed(l.row.parentId))
					.sort((a, b) => a.rid - b.rid)
					.map((l) => ({
						person: people.get(l.row.parentId)!,
						type: l.row.type as ParentChildType
					}))
			])
		);
		const partnersOfChildren = Object.fromEntries(
			childIds.map((id) => [
				id,
				childPartnerRows
					.filter((r) => r.row.personId === id)
					.flatMap((r) =>
						coPartnerRows
							.filter(
								(c) =>
									c.row.unionId === r.row.unionId &&
									c.row.personId !== id &&
									isListed(c.row.personId)
							)
							.map((c) => ({ unionId: c.row.unionId, person: people.get(c.row.personId)! }))
					)
			])
		);
		return {
			page,
			vitals: Object.fromEntries([...partnerIds, ...childIds].map((id) => [id, vitalsOf(id)])),
			parents,
			partnersOfChildren
		};
	}

	private async unionPage(
		treeId: string,
		unionId: string,
		scope: ViewerScope
	): Promise<UnionPageDto> {
		const [[unionRecord], partnerRows, linkRows, eventRows] = await this.repo.run(
			this.repo.unionsIn(treeId, [unionId]),
			this.repo.partnerRowsOfUnions(treeId, [unionId]),
			this.repo.linksBy(treeId, 'union', [unionId]),
			this.repo.eventsOf(treeId, 'FAMILY', [unionId])
		);
		if (!unionRecord) throw new NotFoundError('Partnership', unionId);
		const union = unionRecord.row;

		const partnerIds = partnerRows
			.sort((a, b) => a.row.order - b.row.order || a.rid - b.rid)
			.map((p) => p.row.personId);
		// A partnership with a private partner answers as a missing one: its marriage facts and its
		// children are facts about that partner (ADR-015).
		const seen = scope.isRestricted
			? await visibleAmong(
					this.repo.client,
					treeId,
					[...partnerIds, ...linkRows.map((l) => l.row.childId)],
					scope
				)
			: null;
		const hasPrivatePartner = seen !== null && partnerIds.some((id) => !seen.has(id));
		// Omitting private people means omitting their partnerships; with placeholders the page stands, minus its facts.
		if (hasPrivatePartner && !scope.shouldShowPrivateStructure)
			throw new NotFoundError('Partnership', unionId);
		// A private child is left out, or shown as a placeholder, as the tree's setting says.
		const isChildShown = (id: string) => !seen || seen.has(id) || scope.shouldShowPrivateStructure;
		const links = linkRows
			.sort((a, b) => a.rid - b.rid)
			.map((l) => l.row)
			.filter((l) => isChildShown(l.childId));
		const childIds = [...new Set(links.map((l) => l.childId))];

		// The window around the first partner brings the labels, the twins and the dialogs' graph.
		const graph = partnerIds[0]
			? (
					await loadFocusWindow(
						this.repo,
						treeId,
						partnerIds[0],
						{ ancestorDepth: 1, descendantDepth: 1, shouldIncludeStepFamilies: true },
						scope.isRestricted ? scope : undefined
					)
				).graph
			: EMPTY_GRAPH;
		const labels = partnershipLabels(graph.unions, scope.dateFormat);

		const people = await personSummaries(
			this.repo,
			treeId,
			graph,
			[...partnerIds, ...childIds],
			scope
		);
		const partners = partnerIds.map((id) => people.get(id)!);
		const nameOf = (id: string) => people.get(id)?.displayName ?? 'Unknown';

		// A partnership with a private partner has no facts or evidence to show (ADR-015, ADR-028); the
		// citation reads are filtered the same way in SQL, and this keeps the two in step.
		const cited = hasPrivatePartner
			? {
					rows: [],
					linkParents: new Map<string, string>(),
					linkChildren: new Map<string, string>()
				}
			: await this.evidence.citationsOfUnion(treeId, unionId, scope);
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

		// Notes (ADR-029): on the partnership, its facts, the links filed under it and the citations shown.
		// A link to a private child is not shown with its notes, even where the child stands as a placeholder.
		const noteLinks = links.filter((l) => !seen || seen.has(l.childId));
		const noteItems = await loadNoteDtos(
			this.notes,
			treeId,
			hasPrivatePartner
				? []
				: await this.notes.attachmentsOf(treeId, {
						[NOTE_SUBJECT_KINDS.UNION]: [unionId],
						[NOTE_SUBJECT_KINDS.EVENT]: eventRows.map((e) => e.row.id),
						[NOTE_SUBJECT_KINDS.PARENT_CHILD]: noteLinks.map((l) => l.id),
						[NOTE_SUBJECT_KINDS.CITATION]: cited.rows.map((c) => c.id)
					}),
			scope
		);
		const eventNotes = (id: string): NoteDto[] => notesOf(noteItems, NOTE_SUBJECT_KINDS.EVENT, id);

		// A marriage date and place are facts about the private partner too.
		const events: UnionEventDto[] = (hasPrivatePartner ? [] : eventRows)
			.sort((a, b) => a.rid - b.rid)
			.map(({ row }) => ({
				...privacyOf(row),
				id: row.id,
				type: row.type,
				label: eventLabel(row.type),
				dateText: row.dateRaw,
				sortStart: eventDateValue(row).sortStart,
				place: row.place,
				// A family event's line value is kept in `description` and is not a note of its own (ADR-029).
				notes: row.description,
				isEditable: isUnionEventType(row.type),
				version: row.version,
				citationCount: citationCounts.get(row.id) ?? 0,
				noteItems: eventNotes(row.id)
			}));

		const children: UnionChildDto[] = sortByBirth(childIds, (childId) => ({
			birthSort: people.get(childId)!.birthSort,
			name: people.get(childId)!.displayName
		})).map((childId) => ({
			person: people.get(childId)!,
			links: links
				.filter((l) => l.childId === childId)
				.map((l) => ({
					parentId: l.parentId,
					parentName: nameOf(l.parentId),
					type: l.type as ParentChildType
				}))
		}));

		// ---- Chronology: the partnership's events beside the people's own dates ----
		const entry = (
			kind: ChronologyKind,
			label: string,
			dateText: string | null,
			personId: string | null
		): ChronologyEntryDto => ({
			kind,
			label,
			dateText,
			sortStart: boundsOf(dateText)?.earliest ?? null,
			personId
		});
		const chronology = [
			...events.map((e): ChronologyEntryDto => ({
				kind: CHRONOLOGY_KINDS.UNION_EVENT,
				label: e.label,
				dateText: e.dateText,
				sortStart: e.sortStart,
				personId: null
			})),
			...partners.flatMap((p) => [
				...(p.birthDate
					? [entry(CHRONOLOGY_KINDS.PARTNER_BIRTH, `Birth of ${p.displayName}`, p.birthDate, p.id)]
					: []),
				...(p.isDeceased
					? [entry(CHRONOLOGY_KINDS.PARTNER_DEATH, `Death of ${p.displayName}`, p.deathDate, p.id)]
					: [])
			]),
			...children.flatMap((c) =>
				c.person.birthDate
					? [
							entry(
								CHRONOLOGY_KINDS.CHILD_BIRTH,
								`Birth of ${c.person.displayName}`,
								c.person.birthDate,
								c.person.id
							)
						]
					: []
			)
		]
			.map((item, index) => ({ item, index }))
			.sort((a, b) => {
				const [da, db] = [a.item.sortStart, b.item.sortStart];
				if (da !== db) return da === null ? 1 : db === null ? -1 : da < db ? -1 : 1;
				return a.index - b.index;
			})
			.map(({ item }) => item);

		// ---- Twins and warnings ----
		const key = partnerIds.length > 0 ? partnerSetKey(partnerIds) : null;
		const twins = key
			? graph.unions
					.filter((u) => u.id !== unionId && partnerSetKey(u.partnerIds) === key)
					.map((u) => ({ unionId: u.id, label: labels.get(u.id) ?? null }))
			: [];
		const warningPerson = (p: PersonSummaryDto) => ({
			id: p.id,
			name: p.displayName,
			birth: boundsOf(p.birthDate),
			death: p.isDeceased ? (boundsOf(p.deathDate) ?? { earliest: null, latest: null }) : null
		});
		const warnings = unionWarnings({
			status: union.status,
			partners: partners.map(warningPerson),
			events: events.map((e) => ({
				id: e.id,
				type: e.type,
				label: e.label,
				date: boundsOf(e.dateText)
			})),
			children: children.map((c) => warningPerson(c.person)),
			hasTwin: twins.length > 0
		});

		// ---- History ----
		// See the person page: a change's summary is prose that can name a private person.
		const recent = scope.isRestricted
			? []
			: await this.repo.recentChanges(
					treeId,
					[unionId, ...events.map((e) => e.id)],
					RECENT_CHANGES_SHOWN
				);
		const actors = await this.repo.actorNames(
			treeId,
			recent.map((c) => c.actorId)
		);

		return {
			...privacyOf(union),
			union: {
				id: union.id,
				version: union.version,
				status: union.status as UnionStatus,
				label: labels.get(unionId) ?? null,
				xrefAliases: union.xrefAliases ?? []
			},
			partners,
			events,
			children,
			chronology,
			warnings,
			twins,
			notes: notesOf(noteItems, NOTE_SUBJECT_KINDS.UNION, unionId),
			linkNotes: noteLinks.flatMap((l) => {
				const own = notesOf(noteItems, NOTE_SUBJECT_KINDS.PARENT_CHILD, l.id);
				return own.length > 0
					? [
							{
								id: l.id,
								label: `${nameOf(l.parentId)} as parent of ${nameOf(l.childId)}`,
								notes: own
							}
						]
					: [];
			}),
			evidence: {
				citations: inSubjectOrder(cited.rows).map((c) =>
					citationDto(c, sourcesById, notesOf(noteItems, NOTE_SUBJECT_KINDS.CITATION, c.id))
				),
				links: [...cited.linkParents].map(([id, parentId]) => ({
					id,
					label: `${nameOf(parentId)} as parent of ${nameOf(cited.linkChildren.get(id) ?? '')}`
				}))
			},
			changes: {
				recent: recent.map((c) => changeEntryDto(c, actors, scope)),
				createdAt: union.createdAt,
				updatedAt: union.updatedAt
			},
			graph
		};
	}
}
