/**
 * The bounded graph: the part of a tree a focus view draws, loaded by following relationships
 * outwards from the focus person instead of reading the whole tree.
 *
 * The drawing rules already live in `selectFocusSubgraph`, so the loader does not restate them.
 * It runs the same selection over what it has loaded so far, loads the neighbourhood of every
 * person the selection draws that it has not yet loaded, and repeats until the selection stops
 * asking for anyone new. The result is the graph a whole-tree load would give for everything the
 * view can see, which the tests assert by comparing the two layouts exactly.
 *
 * What "loaded" means for a drawn person, and why each piece is needed:
 * - their partnerships, each with all its partners and child links, or a couple could be drawn
 *   with a partner missing and "1st partnership" labels and merge twins would be wrong;
 * - their parents' unions with all children, so siblings, half-siblings and the ancestor stubs'
 *   counts are right;
 * - their parents' other partnerships, because a step-parent is a parent's partner who is not a
 *   parent, and the graph derives that for every person it names.
 * People a loaded union merely names are fetched as records but stay `isPartial`.
 */

import { NotFoundError } from '../domain/errors';
import type {
	TreeRows,
	EventRow,
	IndividualRow,
	ParentChildRow,
	PersonNameRow,
	UnionPartnerRow,
	UnionRow
} from '../domain/change-log';
import { maskRows, privatePeople } from '../domain/privacy-mask';
import { graphFromRows } from '../domain/relationship-graph';
import { type RelationshipGraph } from '../../shared/relationship-graph';
import { resolveStubTokens } from '../../shared/stub-tokens';
import { selectFocusSubgraph } from '../../tree-layout/select';
import type { FocusSelection, FocusViewOptions } from '../../tree-layout/types';
import type { GraphWindowRepository, Ranked } from '../repositories/graph-window-repository';

/** More rounds than any legal view needs (depth 8 each way); a guard against a loop, not a limit. */
const MAX_ROUNDS = 64;

/** The event types a graph person carries: birth and death text, and whether they are deceased. */
const GRAPH_PERSON_EVENT_TYPES = ['BIRT', 'DEAT'] as const;
/** What privacy needs beyond the vitals: a burial or a christening also says whether someone is living. */
const PRIVACY_EVENT_TYPES = ['BIRT', 'DEAT', 'BURI', 'CREM', 'CHR', 'BAPM'] as const;

/** Set for a viewer who may not see private people (ADR-015); the window then never holds them. */
export interface WindowPrivacy {
	cutoff: string;
	shouldShowPrivateStructure: boolean;
	/** A contributor's own id: the people they created are not hidden from them. */
	creatorId: string | null;
}

export interface FocusWindowOptions extends Omit<FocusViewOptions, 'expandedStubIds'> {
	/** Opened stubs as URL tokens; resolved here so the generation an opened stub reveals is loaded. */
	expandedStubTokens?: string[];
}

export interface FocusWindow {
	focusPersonId: string;
	graph: RelationshipGraph;
	/** What the view draws from this window, for stub counts and for tests. */
	selection: FocusSelection;
	/** Queries issued, to show a window costs a handful of reads and not one per person. */
	roundCount: number;
}

class WindowState {
	constructor(private privacy?: WindowPrivacy) {}

	individuals = new Map<string, Ranked<IndividualRow>>();
	unions = new Map<string, Ranked<UnionRow>>();
	partners = new Map<string, Ranked<UnionPartnerRow>>();
	links = new Map<string, Ranked<ParentChildRow>>();
	events = new Map<string, Ranked<EventRow>>();
	/** People whose whole neighbourhood is loaded; only these are safe to draw. */
	complete = new Set<string>();
	/** People whose partnership rows are loaded (a superset of `complete`: their parents are in it too). */
	hasPartnerships = new Set<string>();
	/** Unions with their partner rows, child links and events all loaded. */
	completeUnions = new Set<string>();
	/** People whose birth and death events are loaded, so nobody's are fetched twice. */
	hasVitals = new Set<string>();
	/** People whose names are loaded; a card says "(née …)" from them, so every named person needs them. */
	hasNames = new Set<string>();
	names = new Map<string, Ranked<PersonNameRow>>();

	private static inserted<T>(
		map: Map<string, Ranked<T>>,
		rows: Array<Ranked<T>>,
		key: (row: T) => string
	) {
		for (const r of rows) map.set(key(r.row), r);
	}

	addIndividuals = (rows: Array<Ranked<IndividualRow>>) =>
		WindowState.inserted(this.individuals, rows, (r) => r.id);
	addUnions = (rows: Array<Ranked<UnionRow>>) =>
		WindowState.inserted(this.unions, rows, (r) => r.id);
	addPartners = (rows: Array<Ranked<UnionPartnerRow>>) =>
		WindowState.inserted(this.partners, rows, (r) => r.id);
	addLinks = (rows: Array<Ranked<ParentChildRow>>) =>
		WindowState.inserted(this.links, rows, (r) => r.id);
	addEvents = (rows: Array<Ranked<EventRow>>) =>
		WindowState.inserted(this.events, rows, (r) => r.id);
	addNames = (rows: Array<Ranked<PersonNameRow>>) =>
		WindowState.inserted(this.names, rows, (r) => r.id);

	/** Every id the loaded rows mention, drawn or not: the candidates a stub token may name. */
	personIds(): string[] {
		const { rows } = this.rows();
		const ids = new Set(rows.individuals.map((i) => i.id));
		for (const row of rows.unionPartners) ids.add(row.personId);
		for (const row of rows.parentChild) {
			ids.add(row.parentId);
			ids.add(row.childId);
		}
		return [...ids];
	}

	/** The loaded rows in table insertion order, shaped like a whole-tree load, before any privacy mask. */
	private unmaskedRows(): TreeRows {
		const inOrder = <T>(map: Map<string, Ranked<T>>) =>
			[...map.values()].sort((a, b) => a.rid - b.rid).map((r) => r.row);
		// A partner row is only kept for a union that is loaded, so a half-loaded union never leaks.
		return {
			individuals: inOrder(this.individuals),
			personNames: inOrder(this.names),
			unions: inOrder(this.unions),
			unionPartners: inOrder(this.partners).filter((p) => this.unions.has(p.unionId)),
			parentChild: inOrder(this.links),
			events: inOrder(this.events),
			mediaItems: [],
			sources: [],
			repositories: [],
			sourceRepositories: [],
			citations: [],
			notes: [],
			noteAttachments: [],
			researchTasks: []
		};
	}

	/** Everyone in the loaded rows whom the viewer may not see; empty when no privacy applies. */
	hiddenPersonIds(): Set<string> {
		return this.privacy
			? privatePeople(this.unmaskedRows(), this.privacy.cutoff, this.privacy.creatorId)
			: new Set();
	}

	rows(): { rows: TreeRows; placeholderIds: Set<string> } {
		const rows = this.unmaskedRows();
		return this.privacy
			? maskRows(
					rows,
					this.privacy.cutoff,
					this.privacy.shouldShowPrivateStructure,
					this.privacy.creatorId
				)
			: { rows, placeholderIds: new Set() };
	}

	graph(): RelationshipGraph {
		const { rows, placeholderIds } = this.rows();
		const graph = graphFromRows(rows, placeholderIds);
		return {
			...graph,
			people: graph.people.map((p) =>
				this.complete.has(p.id) ? p : { ...p, isPartial: true as const }
			)
		};
	}
}

export async function loadFocusWindow(
	repo: GraphWindowRepository,
	treeId: string,
	focusPersonId: string,
	options: FocusWindowOptions = {},
	privacy?: WindowPrivacy
): Promise<FocusWindow> {
	const state = new WindowState(privacy);
	const personEventTypes = privacy ? PRIVACY_EVENT_TYPES : GRAPH_PERSON_EVENT_TYPES;
	const { expandedStubTokens = [], ...viewOptions } = options;

	const [focus] = await repo.run(repo.individualsIn(treeId, [focusPersonId]));
	if (focus.length === 0) throw new NotFoundError('Person', focusPersonId);
	state.addIndividuals(focus);

	/** Load the neighbourhood of these people; see the module comment for what that covers. */
	async function expand(people: string[]): Promise<void> {
		const [ownPartnerships, asChild, asParent] = await repo.run(
			repo.partnerRowsOfPersons(treeId, people),
			repo.linksBy(treeId, 'child', people),
			repo.linksBy(treeId, 'parent', people)
		);
		state.addPartners(ownPartnerships);
		state.addLinks([...asChild, ...asParent]);
		people.forEach((id) => state.hasPartnerships.add(id));

		// A parent's other partnerships make the step-parents; the parents themselves stay partial.
		const parentIds = asChild
			.map((l) => l.row.parentId)
			.filter((id) => !state.hasPartnerships.has(id));
		const [parentPartnerships] = await repo.run(repo.partnerRowsOfPersons(treeId, parentIds));
		state.addPartners(parentPartnerships);
		parentIds.forEach((id) => state.hasPartnerships.add(id));

		const unionIds = new Set<string>();
		for (const p of [...ownPartnerships, ...parentPartnerships]) unionIds.add(p.row.unionId);
		for (const l of [...asChild, ...asParent]) if (l.row.unionId) unionIds.add(l.row.unionId);
		const newUnionIds = [...unionIds].filter((id) => !state.completeUnions.has(id));

		const [unionRows, partnerRows, unionLinks, unionEvents] = await repo.run(
			repo.unionsIn(treeId, newUnionIds),
			repo.partnerRowsOfUnions(treeId, newUnionIds),
			repo.linksBy(treeId, 'union', newUnionIds),
			repo.eventsOf(treeId, 'FAMILY', newUnionIds)
		);
		state.addUnions(unionRows);
		state.addPartners(partnerRows);
		state.addLinks(unionLinks);
		state.addEvents(unionEvents);
		newUnionIds.forEach((id) => state.completeUnions.add(id));

		// Records for everyone a loaded union or link names next to a drawn person, so cards and
		// dialogs have names; only the people asked for become complete.
		const named = new Set<string>(people);
		for (const p of partnerRows) named.add(p.row.personId);
		for (const l of asChild) named.add(l.row.parentId);
		// Without privacy a child is loaded when the view draws them. With it, every link's far end
		// must be loaded now, or a private child would still be counted in a stub before being seen.
		if (privacy) for (const l of [...asParent, ...unionLinks]) named.add(l.row.childId);
		const missing = [...named].filter((id) => !state.individuals.has(id));
		const withoutVitals = [...named].filter((id) => !state.hasVitals.has(id));
		const withoutNames = [...named].filter((id) => !state.hasNames.has(id));
		const [records, personEvents, personNameRows] = await repo.run(
			repo.individualsIn(treeId, missing),
			repo.eventsOf(treeId, 'INDIVIDUAL', withoutVitals, personEventTypes),
			repo.namesOf(withoutNames)
		);
		state.addIndividuals(records);
		state.addEvents(personEvents);
		state.addNames(personNameRows);
		withoutNames.forEach((id) => state.hasNames.add(id));
		withoutVitals.forEach((id) => state.hasVitals.add(id));
		people.forEach((id) => state.complete.add(id));
	}

	let roundCount = 0;
	await expand([focusPersonId]);
	roundCount++;
	// A private focus answers exactly as a missing one does.
	if (state.hiddenPersonIds().has(focusPersonId)) throw new NotFoundError('Person', focusPersonId);

	for (; roundCount <= MAX_ROUNDS; roundCount++) {
		const graph = state.graph();
		const expandedStubIds = resolveStubTokens(
			expandedStubTokens,
			state.personIds(),
			state.rows().rows.unions.map((u) => u.id)
		);
		const selection = selectFocusSubgraph(graph, focusPersonId, {
			...viewOptions,
			expandedStubIds
		});
		if (!selection) throw new NotFoundError('Person', focusPersonId);
		const needed = selection.people.map((p) => p.id).filter((id) => !state.complete.has(id));
		if (needed.length === 0) return { focusPersonId, graph, selection, roundCount };
		await expand(needed);
	}
	throw new Error(
		'The focus window did not settle; the tree contains a cycle the selection cannot bound'
	);
}
