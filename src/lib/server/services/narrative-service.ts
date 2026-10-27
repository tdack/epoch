/**
 * The ancestor and descendant narratives (reports plan, stage 6): who is in them comes from the
 * charts, which already decide what the viewer may see; what is said about each person is read in a
 * handful of batched queries, however many people the report holds, and told by `narrativeOf`.
 */

import type { DbClient } from '../db';
import type { AuthenticatedContext } from '../domain/identity';
import { eventDateValue } from '../domain/date-columns';
import { PRIVATE_PLACEHOLDER_NAME } from '../domain/privacy-mask';
import { eventLabel } from '../domain/tree-labels';
import type { EventRow } from '../domain/change-log';
import { EvidenceRepository } from '../repositories/evidence-repository';
import { GraphWindowRepository } from '../repositories/graph-window-repository';
import { TreeRepository } from '../repositories/tree-repository';
import { UserRepository } from '../repositories/user-repository';
import { ChartService } from './chart-service';
import { citationDto } from './evidence-dto';
import { personSummaries } from './person-summaries';
import { requireTreeScope, type ViewerScope } from './tree-access';
import type { ChartPerson, DescendantNode } from '../../shared/charts';
import { DEFAULT_DATE_FORMAT } from '../../shared/date-display';
import { descendantNumber, type DescendantNumbering } from '../../shared/descendant-numbers';
import {
	Endnotes,
	narrativeOf,
	type NarrativeChild,
	type NarrativeFact,
	type NarrativePerson,
	type NoteRef
} from '../../shared/narrative';
import type { ParentChildType } from '../../shared/relationship-model';
import {
	NARRATIVE_KINDS,
	type NarrativeDto,
	type NarrativeEntryDto,
	type NarrativeKind
} from '../../shared/reports';

/** Who a report tells of, in the order it tells them, before anything is said about them. */
interface Slot {
	number: string;
	generation: number;
	person: ChartPerson;
}

function ancestorSlots(slots: Array<ChartPerson | null>): Slot[] {
	return slots.flatMap((person, index) =>
		person
			? [{ number: `${index + 1}`, generation: Math.floor(Math.log2(index + 1)) + 1, person }]
			: []
	);
}

/** Generation by generation, as a Register-style report reads, each numbered from its path. */
function descendantSlots(root: DescendantNode, numbering: DescendantNumbering): Slot[] {
	const out: Slot[] = [];
	let level: Array<{ node: DescendantNode; path: number[] }> = [{ node: root, path: [] }];
	while (level.length > 0) {
		for (const { node, path } of level)
			out.push({
				number: descendantNumber(path, numbering),
				generation: path.length + 1,
				person: node.person
			});
		level = level.flatMap(({ node, path }) =>
			node.children.map((child, index) => ({ node: child, path: [...path, index + 1] }))
		);
	}
	return out;
}

const bySortThenOrder = (a: EventRow, b: EventRow) => {
	const [da, db] = [eventDateValue(a).sortStart, eventDateValue(b).sortStart];
	if (da !== db) return da === null ? 1 : db === null ? -1 : da < db ? -1 : 1;
	return a.sortOrder - b.sortOrder;
};

export class NarrativeService {
	private repo: GraphWindowRepository;
	private evidence: EvidenceRepository;
	private users: UserRepository;
	private trees: TreeRepository;
	private charts: ChartService;

	constructor(
		db: DbClient,
		private now: () => Date = () => new Date()
	) {
		this.repo = new GraphWindowRepository(db);
		this.evidence = new EvidenceRepository(db);
		this.users = new UserRepository(db);
		this.trees = new TreeRepository(db);
		this.charts = new ChartService(db, now);
	}

	async narrative(
		treeId: string,
		personId: string,
		kind: NarrativeKind,
		generations: number,
		numbering: DescendantNumbering,
		context: AuthenticatedContext
	): Promise<NarrativeDto> {
		const scope = await requireTreeScope(
			this.users,
			this.trees,
			treeId,
			context,
			'tree:view',
			this.now()
		);
		let slots: Slot[];
		let subject: ChartPerson;
		let hasMore: boolean;
		if (kind === NARRATIVE_KINDS.ANCESTORS) {
			const pedigree = await this.charts.pedigree(treeId, personId, generations, context);
			slots = ancestorSlots(pedigree.slots);
			subject = pedigree.person;
			hasMore = pedigree.hasMoreAbove;
		} else {
			const tree = await this.charts.descendants(treeId, personId, generations, context);
			slots = descendantSlots(tree.root, numbering);
			subject = tree.root.person;
			hasMore = tree.hasMoreBelow;
		}

		const firstNumber = new Map<string, string>();
		for (const slot of slots)
			if (!firstNumber.has(slot.person.id)) firstNumber.set(slot.person.id, slot.number);
		const told = [...firstNumber.keys()].filter(
			(id) => !slots.find((s) => s.person.id === id)!.person.isPrivate
		);
		const people = await this.peopleOf(treeId, told, firstNumber, scope);

		const format = scope.dateFormat ?? DEFAULT_DATE_FORMAT;
		const endnotes = new Endnotes();
		const entries: NarrativeEntryDto[] = slots.map((slot) => {
			const isRepeat = firstNumber.get(slot.person.id) !== slot.number;
			const input = people.get(slot.person.id);
			return {
				number: slot.number,
				generation: slot.generation,
				personId: slot.person.id,
				name: slot.person.isPrivate ? PRIVATE_PLACEHOLDER_NAME : slot.person.name,
				isPrivate: slot.person.isPrivate,
				seeNumber: isRepeat ? firstNumber.get(slot.person.id)! : null,
				sentences: !isRepeat && input ? narrativeOf(input, format, endnotes) : []
			};
		});
		return {
			kind,
			person: subject,
			generations,
			hasMore,
			numbering: kind === NARRATIVE_KINDS.DESCENDANTS ? numbering : null,
			entries,
			endnotes: endnotes.list()
		};
	}

	/** Everything said about each person, masked as the person and partnership pages mask it. */
	private async peopleOf(
		treeId: string,
		ids: string[],
		numbers: ReadonlyMap<string, string>,
		scope: ViewerScope
	): Promise<Map<string, NarrativePerson>> {
		if (ids.length === 0) return new Map();
		const [individuals, eventRows, partnerRows, parentLinks, childLinks] = await this.repo.run(
			this.repo.individualsIn(treeId, ids),
			this.repo.eventsOf(treeId, 'INDIVIDUAL', ids),
			this.repo.partnerRowsOfPersons(treeId, ids),
			this.repo.linksBy(treeId, 'child', ids),
			this.repo.linksBy(treeId, 'parent', ids)
		);
		const unionIds = [...new Set(partnerRows.map((r) => r.row.unionId))];
		const [coPartnerRows, unionEventRows] = await this.repo.run(
			this.repo.partnerRowsOfUnions(treeId, unionIds),
			this.repo.eventsOf(treeId, 'FAMILY', unionIds)
		);
		const related = [
			...parentLinks.map((l) => l.row.parentId),
			...childLinks.map((l) => l.row.childId),
			...coPartnerRows.map((r) => r.row.personId)
		];
		const summaries = await personSummaries(
			this.repo,
			treeId,
			undefined,
			[...new Set([...ids, ...related])],
			scope
		);
		const isPrivate = (id: string) => summaries.get(id)?.isPrivate ?? true;
		// A private relative is named as a placeholder or left out, as the tree's setting says.
		const nameOf = (id: string) =>
			!isPrivate(id)
				? summaries.get(id)!.displayName
				: scope.shouldShowPrivateStructure
					? PRIVATE_PLACEHOLDER_NAME
					: null;

		const unionHasPrivatePartner = new Set(
			coPartnerRows.filter((r) => isPrivate(r.row.personId)).map((r) => r.row.unionId)
		);
		// Facts of a partnership with a private partner are facts about that partner too (ADR-015).
		const shownUnionEvents = unionEventRows
			.map((e) => e.row)
			.filter((e) => !unionHasPrivatePartner.has(e.entityId));
		const allEvents = [...eventRows.map((e) => e.row), ...shownUnionEvents];
		const notes = await this.notesByEvent(
			treeId,
			allEvents.map((e) => e.id),
			scope
		);
		const factOf = (row: EventRow): NarrativeFact => ({
			type: row.type,
			label: eventLabel(row.type),
			dateText: row.dateRaw,
			place: row.place,
			value: row.value,
			notes: notes.get(row.id) ?? []
		});
		const childOf = (link: { childId: string; type: string }): NarrativeChild[] => {
			const name = nameOf(link.childId);
			return name
				? [
						{
							name,
							number: isPrivate(link.childId) ? null : (numbers.get(link.childId) ?? null),
							type: link.type as ParentChildType
						}
					]
				: [];
		};

		const out = new Map<string, NarrativePerson>();
		for (const { row: person } of individuals) {
			const id = person.id;
			const myUnions = partnerRows
				.filter((r) => r.row.personId === id)
				.sort((a, b) => a.rid - b.rid)
				.map((r) => r.row.unionId);
			const myChildLinks = childLinks
				.filter((l) => l.row.parentId === id)
				.sort((a, b) => a.rid - b.rid)
				.map((l) => l.row);
			const name = summaries.get(id)!.displayName;
			out.set(id, {
				name,
				givenName: person.givenName?.trim().split(/\s+/)[0] || name.split(' ')[0]!,
				parents: parentLinks
					.filter((l) => l.row.childId === id)
					.sort((a, b) => a.rid - b.rid)
					.flatMap((l) => {
						const parent = nameOf(l.row.parentId);
						return parent ? [{ name: parent, type: l.row.type as ParentChildType }] : [];
					}),
				facts: eventRows
					.map((e) => e.row)
					.filter((e) => e.entityId === id)
					.sort(bySortThenOrder)
					.map(factOf),
				partnerships: myUnions.map((unionId) => {
					const partners = coPartnerRows
						.filter((r) => r.row.unionId === unionId && r.row.personId !== id)
						.flatMap((r) => nameOf(r.row.personId) ?? []);
					return {
						partnerName: partners.length > 0 ? partners.join(' and ') : null,
						events: shownUnionEvents
							.filter((e) => e.entityId === unionId)
							.sort(bySortThenOrder)
							.map(factOf),
						children: myChildLinks.filter((l) => l.unionId === unionId).flatMap(childOf)
					};
				}),
				otherChildren: myChildLinks
					.filter((l) => !l.unionId || !myUnions.includes(l.unionId))
					.flatMap(childOf)
			});
		}
		return out;
	}

	/** Each fact's citations as endnote references: one note per source and page. */
	private async notesByEvent(
		treeId: string,
		eventIds: string[],
		scope: ViewerScope
	): Promise<Map<string, NoteRef[]>> {
		const rows = await this.evidence.citationsOfEvents(treeId, eventIds, scope);
		const sources = new Map(
			(
				await this.evidence.sourcesByIds(
					treeId,
					rows.flatMap((c) => (c.sourceId ? [c.sourceId] : []))
				)
			).map((s) => [s.id, s])
		);
		const out = new Map<string, NoteRef[]>();
		for (const row of [...rows].sort((a, b) => a.sortOrder - b.sortOrder)) {
			const dto = citationDto(row, sources);
			const ref: NoteRef = {
				key: `${dto.sourceId ?? dto.sourceLabel}|${dto.page ?? ''}`,
				text: `${dto.sourceLabel}${dto.page ? `, ${dto.page}` : ''}.`
			};
			out.set(row.subjectId, [...(out.get(row.subjectId) ?? []), ref]);
		}
		return out;
	}
}
