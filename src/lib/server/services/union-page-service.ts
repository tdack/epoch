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
import type { ParentChildType, UnionStatus } from '../domain/genealogy-model';
import type { RelationshipGraph } from '../domain/relationship-graph';
import { eventLabel } from '../domain/tree-labels';
import { GraphWindowRepository } from '../repositories/graph-window-repository';
import { TreeRepository } from '../repositories/tree-repository';
import { UserRepository } from '../repositories/user-repository';
import { visibleAmong } from '../repositories/visibility';
import { partnershipLabels, type PartnershipLabel } from '../../shared/partnership-labels';
import { privacyOf, type PrivacyFlag } from '../../shared/privacy';
import { partnerSetKey } from '../../shared/union-merge';
import { isUnionEventType } from '../../shared/union-events';
import { boundsOf, unionWarnings, type UnionWarning } from '../../shared/union-warnings';
import { loadFocusWindow } from './focus-window';
import { RECENT_CHANGES_SHOWN, type ChangeEntryDto } from './person-page-service';
import { personSummaries, type PersonSummaryDto } from './person-summaries';
import { requireTreeScope, type ViewerScope } from './tree-access';

interface UnionEventDto extends PrivacyFlag {
	id: string;
	type: string;
	label: string;
	dateText: string | null;
	sortStart: string | null;
	place: string | null;
	/** The note or imported description on the event. */
	notes: string | null;
	/** The union editor can change events of this type; others (a census, say) are shown as recorded. */
	isEditable: boolean;
	version: number;
}

export const CHRONOLOGY_KINDS = {
	UNION_EVENT: 'union_event',
	PARTNER_BIRTH: 'partner_birth',
	PARTNER_DEATH: 'partner_death',
	CHILD_BIRTH: 'child_birth'
} as const;
type ChronologyKind = (typeof CHRONOLOGY_KINDS)[keyof typeof CHRONOLOGY_KINDS];

interface ChronologyEntryDto {
	kind: ChronologyKind;
	label: string;
	dateText: string | null;
	sortStart: string | null;
	/** The person the entry is about, or null for the partnership's own events. */
	personId: string | null;
}

interface UnionChildDto {
	person: PersonSummaryDto;
	/** One entry per parent link, so a child adopted by one partner reads as such. */
	links: Array<{ parentId: string; parentName: string; type: ParentChildType }>;
}

export interface UnionPageDto extends PrivacyFlag {
	union: {
		id: string;
		version: number;
		status: UnionStatus;
		label: PartnershipLabel | null;
		/** XREFs of partnerships merged into this one (ADR-008). */
		xrefAliases: string[];
	};
	partners: PersonSummaryDto[];
	events: UnionEventDto[];
	children: UnionChildDto[];
	/** Events and vitals in date order, undated last. */
	chronology: ChronologyEntryDto[];
	warnings: UnionWarning[];
	/** Other partnerships with exactly the same partners. */
	twins: Array<{ unionId: string; label: PartnershipLabel | null }>;
	changes: { recent: ChangeEntryDto[]; createdAt: number | null; updatedAt: number | null };
	/** The window around the first partner, for the editing dialogs. */
	graph: RelationshipGraph;
}

const EMPTY_GRAPH: RelationshipGraph = { people: [], unions: [], parentChild: [] };

export class UnionPageService {
	private repo: GraphWindowRepository;
	private users: UserRepository;
	private trees: TreeRepository;

	constructor(
		db: DbClient,
		private now: () => Date = () => new Date()
	) {
		this.repo = new GraphWindowRepository(db);
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
		const scope = await this.requireView(treeId, context);

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
		const labels = partnershipLabels(graph.unions);

		const people = await personSummaries(
			this.repo,
			treeId,
			graph,
			[...partnerIds, ...childIds],
			scope
		);
		const partners = partnerIds.map((id) => people.get(id)!);
		const nameOf = (id: string) => people.get(id)?.displayName ?? 'Unknown';

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
				notes: row.notes ?? row.description,
				isEditable: isUnionEventType(row.type),
				version: row.version
			}));

		const children: UnionChildDto[] = childIds.map((childId) => ({
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
		const actors = await this.repo.actorNames(recent.map((c) => c.actorId));

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
			changes: {
				recent: recent.map((c) => ({
					id: c.id,
					kind: c.kind,
					summary: c.summary,
					actorName: actors.get(c.actorId) ?? null,
					createdAt: c.createdAt,
					isUndo: c.revertsChangeId !== null
				})),
				createdAt: union.createdAt,
				updatedAt: union.updatedAt
			},
			graph
		};
	}
}
