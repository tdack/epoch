/**
 * Read model for a person's page: everything one screen shows about them, from a handful of
 * bounded reads. The relatives come from the same focus window the tree uses (one generation each
 * way, with siblings and step-families on), so the page and the canvas cannot disagree about who
 * someone's family is.
 */

import type { DbClient } from '../db';
import { isActionAllowed } from '../auth/authorization';
import { NotFoundError, UnauthorizedError } from '../domain/errors';
import type { AuthenticatedContext } from '../domain/identity';
import type { EventRow, IndividualRow, MediaRow, PersonNameRow } from '../domain/change-log';
import { eventDateValue } from '../domain/date-columns';
import type { NameType, ParentChildType, UnionStatus } from '../domain/genealogy-model';
import type { GraphUnionEvent, RelationshipGraph, RelationshipGraphPerson } from '../domain/relationship-graph';
import { GraphWindowRepository } from '../repositories/graph-window-repository';
import { UserRepository } from '../repositories/user-repository';
import { CONFLICT_KINDS, findFactConflicts, sortTimeline, type FactConflict } from '../../shared/fact-timeline';
import { FACT_KINDS, factTypeInfo, factLabel, type FactKind } from '../../shared/fact-types';
import { personName } from '../../shared/person-name';
import { partnershipLabels, type PartnershipLabel } from '../../shared/partnership-labels';
import { privacyOf, type PrivacyFlag } from '../../shared/privacy';
import { relativesOf } from '../../shared/relatives';
import { isSex, type Sex } from '../../shared/sex';
import { mergeableUnionIds } from '../../shared/union-merge';
import { widowhoods } from '../../shared/widowhood';
import { loadFocusWindow } from './focus-window';

/** How many changes the page lists; the full history is Phase 4's change view. */
export const RECENT_CHANGES_SHOWN = 15;

/** Enough to draw a link to someone: no relatives, no facts. */
export interface PersonSummaryDto extends PrivacyFlag {
	id: string;
	displayName: string;
	sex: Sex | null;
	birthDate: string | null;
	deathDate: string | null;
	isDeceased: boolean;
}

export interface FactDto extends PrivacyFlag {
	id: string;
	type: string;
	label: string;
	kind: FactKind;
	/** As typed or imported; never rewritten. */
	dateText: string | null;
	/** Inclusive lower bound, for ordering; null when undated or not a date. */
	sortStart: string | null;
	isApproximate: boolean;
	place: string | null;
	value: string | null;
	cause: string | null;
	age: string | null;
	/** The note, or the imported description on a fact nobody has edited since. */
	notes: string | null;
	/** True when `notes` is a legacy imported description (its real role was never recorded). */
	isLegacyNote: boolean;
	sortOrder: number;
	/** Send this back when editing; a newer stored version is a conflict. */
	version: number;
	/** Set when another fact of the same type disagrees with, or repeats, this one. */
	conflict: FactConflict | null;
}

export interface NameDto extends PrivacyFlag {
	/** Null for the name derived from the person's own name fields when none is stored. */
	id: string | null;
	type: NameType;
	givenName: string | null;
	surname: string | null;
	prefix: string | null;
	suffix: string | null;
	displayName: string;
	isPreferred: boolean;
}

export interface ParentFamilyDto {
	unionId: string | null;
	label: PartnershipLabel | null;
	parents: Array<{ person: PersonSummaryDto; type: ParentChildType }>;
}

export interface PartnershipDto extends PrivacyFlag {
	unionId: string;
	version: number;
	status: UnionStatus;
	label: PartnershipLabel | null;
	/** The person is a widow(er) in this partnership: it has not ended and a partner has died. */
	isWidowed: boolean;
	/** Another partnership has exactly the same partners, so the two can be merged. */
	isMergeable: boolean;
	partners: PersonSummaryDto[];
	children: Array<{ person: PersonSummaryDto; types: ParentChildType[] }>;
	events: GraphUnionEvent[];
}

export interface MediaDto extends PrivacyFlag {
	id: string;
	title: string | null;
	mimeType: string;
	r2ObjectKey: string;
}

export interface ChangeEntryDto {
	id: string;
	kind: string;
	summary: string;
	actorName: string | null;
	/** Epoch milliseconds. */
	createdAt: number;
	isUndo: boolean;
}

/** A section whose content arrives in a later phase; present so the page and its data have a shape. */
export interface PlaceholderDto {
	isSupported: false;
	items: [];
}

export interface PersonPageDto extends PrivacyFlag {
	person: {
		id: string;
		xrefId: string | null;
		version: number;
		sex: Sex;
		givenName: string | null;
		surname: string | null;
		displayName: string;
		isDeceased: boolean;
	};
	names: NameDto[];
	vitals: { birth: FactDto | null; death: FactDto | null; lifespan: string | null; hasConflict: boolean };
	/** Every fact, in timeline order. */
	facts: FactDto[];
	parentFamilies: ParentFamilyDto[];
	partnerships: PartnershipDto[];
	/** Children recorded with no partnership. */
	directChildren: Array<{ person: PersonSummaryDto; types: ParentChildType[] }>;
	siblings: { full: PersonSummaryDto[]; half: PersonSummaryDto[] };
	stepParents: Array<{ person: PersonSummaryDto; unionId: string }>;
	stepChildren: Array<{ person: PersonSummaryDto; via: PersonSummaryDto; unionId: string }>;
	media: MediaDto[];
	notes: PlaceholderDto;
	evidence: PlaceholderDto;
	changes: {
		/**
		 * Changes that wrote the person or a fact they still have. Changes to a fact that was later
		 * removed are not listed: the log finds a change by the record it wrote, and that record is
		 * gone. Phase 4's change view reads the log directly and has no such gap.
		 */
		recent: ChangeEntryDto[];
		/** Epoch milliseconds the person's row was created and last written. */
		createdAt: number | null;
		updatedAt: number | null;
	};
	/** The window the relatives came from, for the editing dialogs (partnerships, versions, labels). */
	graph: RelationshipGraph;
}

const PLACEHOLDER: PlaceholderDto = { isSupported: false, items: [] };

/** Birth and death text of the first such fact, in the order the graph reads them. */
function vitalsOf(rows: EventRow[]): { birthDate: string | null; deathDate: string | null; isDeceased: boolean } {
	const first = (type: string) => rows.find((e) => e.type === type);
	return { birthDate: first('BIRT')?.dateRaw ?? null, deathDate: first('DEAT')?.dateRaw ?? null, isDeceased: first('DEAT') !== undefined };
}

function summaryOfGraphPerson(person: RelationshipGraphPerson): PersonSummaryDto {
	return {
		...privacyOf(person),
		id: person.id,
		displayName: person.displayName,
		sex: person.sex,
		birthDate: person.birthDate ?? null,
		deathDate: person.deathDate ?? null,
		isDeceased: person.isDeceased
	};
}

function summaryOfRows(person: IndividualRow, events: EventRow[]): PersonSummaryDto {
	return {
		...privacyOf(person),
		id: person.id,
		displayName: personName(person),
		sex: isSex(person.sex) ? person.sex : 'U',
		...vitalsOf(events)
	};
}

export function factDto(row: EventRow, conflict: FactConflict | null): FactDto {
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
		notes: row.notes ?? row.description,
		isLegacyNote: row.notes === null && row.description !== null,
		sortOrder: row.sortOrder,
		version: row.version,
		conflict
	};
}

function nameDtos(person: IndividualRow, rows: PersonNameRow[]): NameDto[] {
	if (rows.length === 0) {
		// Editor-created people have no stored name row; their name fields are their only name.
		return [
			{
				...privacyOf(person),
				id: null,
				type: 'birth',
				givenName: person.givenName,
				surname: person.surname,
				prefix: null,
				suffix: null,
				displayName: personName(person),
				isPreferred: true
			}
		];
	}
	return [...rows]
		.sort((a, b) => Number(b.isPreferred) - Number(a.isPreferred) || a.order - b.order)
		.map((n) => ({
			...privacyOf(n),
			id: n.id,
			type: n.type as NameType,
			givenName: n.givenName,
			surname: n.surname,
			prefix: n.namePrefix,
			suffix: n.nameSuffix,
			displayName: [n.namePrefix, n.givenName, n.surname, n.nameSuffix].filter(Boolean).join(' ') || 'Unknown',
			isPreferred: n.isPreferred
		}));
}

export class PersonPageService {
	private repo: GraphWindowRepository;
	private users: UserRepository;

	constructor(db: DbClient) {
		this.repo = new GraphWindowRepository(db);
		this.users = new UserRepository(db);
	}

	private async requireView(treeId: string, context: AuthenticatedContext): Promise<void> {
		const membership = await this.users.getMembership(treeId, context.user.id);
		if (!membership || !isActionAllowed(membership.role, 'tree:view')) {
			throw new UnauthorizedError("Forbidden: insufficient privileges for action 'tree:view'");
		}
	}

	async getPerson(treeId: string, personId: string, context: AuthenticatedContext): Promise<PersonPageDto> {
		await this.requireView(treeId, context);

		const window = await loadFocusWindow(this.repo, treeId, personId, {
			ancestorDepth: 1,
			descendantDepth: 1,
			shouldIncludeSiblings: true,
			shouldIncludeStepFamilies: true
		});
		const { graph } = window;
		const relatives = relativesOf(graph, personId);

		const [[self], nameRows, factRows, mediaRows] = await this.repo.run(
			this.repo.individualsIn(treeId, [personId]),
			this.repo.namesOf([personId]),
			this.repo.eventsOf(treeId, 'INDIVIDUAL', [personId]),
			this.repo.mediaOf(treeId, [personId])
		);
		if (!self) throw new NotFoundError('Person', personId);

		// Half-siblings and the like are named by the graph only if the window drew them; fetch the rest.
		const summaries = new Map(graph.people.map((p) => [p.id, summaryOfGraphPerson(p)]));
		const wanted = new Set<string>([
			...relatives.parentFamilies.flatMap((f) => f.parents.map((p) => p.personId)),
			...relatives.partnerships.flatMap((p) => [...p.partnerIds, ...p.children.map((c) => c.personId)]),
			...relatives.directChildren.map((c) => c.personId),
			...relatives.siblings.full,
			...relatives.siblings.half,
			...relatives.stepParents.map((s) => s.personId),
			...relatives.stepChildren.flatMap((s) => [s.personId, s.viaPartnerId])
		]);
		const missing = [...wanted].filter((id) => !summaries.has(id));
		if (missing.length > 0) {
			const [records, vitalEvents] = await this.repo.run(
				this.repo.individualsIn(treeId, missing),
				this.repo.eventsOf(treeId, 'INDIVIDUAL', missing, ['BIRT', 'DEAT'])
			);
			for (const { row } of records) {
				summaries.set(row.id, summaryOfRows(row, vitalEvents.filter((e) => e.row.entityId === row.id).map((e) => e.row)));
			}
		}
		const summary = (id: string): PersonSummaryDto =>
			summaries.get(id) ?? { ...privacyOf(), id, displayName: 'Unknown', sex: null, birthDate: null, deathDate: null, isDeceased: false };

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
				notes: row.notes ?? row.description,
				sortOrder: row.sortOrder
			}))
		);
		const conflicts = findFactConflicts(timeline);
		const rowById = new Map(rows.map((row) => [row.id, row]));
		const facts = timeline.map((t) => factDto(rowById.get(t.id)!, conflicts.get(t.id) ?? null));
		const birth = facts.find((f) => f.type === 'BIRT') ?? null;
		const death = facts.find((f) => f.type === 'DEAT') ?? null;
		const lifespanParts = [birth?.dateText, death?.dateText];
		const vitals = {
			birth,
			death,
			lifespan: lifespanParts.some(Boolean) ? `${lifespanParts[0] ?? '?'} – ${lifespanParts[1] ?? ''}`.trim() : null,
			hasConflict: [birth, death].some((f) => f?.conflict?.kind === CONFLICT_KINDS.CONFLICT)
		};

		// ---- Partnerships ----
		const labels = partnershipLabels(graph.unions);
		const mergeable = mergeableUnionIds(graph.unions);
		const deceased = new Set(graph.people.filter((p) => p.isDeceased).map((p) => p.id));
		const widowed = new Set(
			widowhoods(graph.unions.map((u) => ({ id: u.id, status: u.status, partnerIds: u.partnerIds })), deceased)
				.filter((w) => w.widowId === personId)
				.map((w) => w.unionId)
		);
		const unionById = new Map(graph.unions.map((u) => [u.id, u]));
		const childEntry = (c: { personId: string; types: ParentChildType[] }) => ({ person: summary(c.personId), types: c.types });

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
				children: p.children.map(childEntry),
				events: union.events ?? []
			};
		});

		// ---- History ----
		const recent = await this.repo.recentChanges(treeId, [personId, ...rows.map((r) => r.id)], RECENT_CHANGES_SHOWN);
		const actors = await this.repo.actorNames(recent.map((c) => c.actorId));

		return {
			...privacyOf(self.row),
			person: {
				id: self.row.id,
				xrefId: self.row.xrefId,
				version: self.row.version,
				sex: isSex(self.row.sex) ? self.row.sex : 'U',
				givenName: self.row.givenName,
				surname: self.row.surname,
				displayName: personName(self.row),
				isDeceased: death !== null
			},
			names: nameDtos(self.row, nameRows.map((n) => n.row)),
			vitals,
			facts,
			parentFamilies: relatives.parentFamilies.map((f) => ({
				unionId: f.unionId,
				label: f.unionId ? (labels.get(f.unionId) ?? null) : null,
				parents: f.parents.map((p) => ({ person: summary(p.personId), type: p.type }))
			})),
			partnerships,
			directChildren: relatives.directChildren.map(childEntry),
			siblings: { full: relatives.siblings.full.map(summary), half: relatives.siblings.half.map(summary) },
			stepParents: relatives.stepParents.map((s) => ({ person: summary(s.personId), unionId: s.unionId })),
			stepChildren: relatives.stepChildren.map((s) => ({ person: summary(s.personId), via: summary(s.viaPartnerId), unionId: s.unionId })),
			media: mediaRows.map(({ row }: { row: MediaRow }) => ({ ...privacyOf(row), id: row.id, title: row.title, mimeType: row.mimeType, r2ObjectKey: row.r2ObjectKey })),
			notes: PLACEHOLDER,
			evidence: PLACEHOLDER,
			changes: {
				recent: recent.map((c) => ({
					id: c.id,
					kind: c.kind,
					summary: c.summary,
					actorName: actors.get(c.actorId) ?? null,
					createdAt: c.createdAt,
					isUndo: c.revertsChangeId !== null
				})),
				createdAt: self.row.createdAt,
				updatedAt: self.row.updatedAt
			},
			graph
		};
	}
}
