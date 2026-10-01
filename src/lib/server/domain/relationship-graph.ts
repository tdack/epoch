/**
 * Read-only relationship graph (Phase 2).
 *
 * Consumes neutral-model DTOs (people, names, unions, partners, parent-child
 * assertions, events) and produces a serializable graph that never normalizes
 * away repeated unions or single-parent groups. Parentage is per-parent typed
 * assertions; step relationships are derived from a parent's union; widowhood
 * and deceased markers are derived from death events.
 */

import type { PersonNameRow, TreeRows } from './change-log';
import { birthSurnameOf } from '../../shared/name-types';
import type { ParentChildType, UnionStatus } from './genealogy-model';
import { isUnionEventType, UNION_EVENT_TYPE_LIST, type UnionEventType } from '../../shared/union-events';
import type { Sex } from '../../shared/sex';
import { privacyOf, type PrivacyFlag } from '../../shared/privacy';

/** A partnership event as the graph carries it, for labels and for the union editor. */
export interface GraphUnionEvent {
	id: string;
	type: UnionEventType;
	dateText: string | null;
	/** Sort key of the date, so partnerships can be put in order without parsing text in the browser. */
	dateSort?: string | null;
	place: string | null;
}

export interface GraphPersonInput {
	id: string;
	givenName: string | null;
	surname: string | null;
	sex: Sex | null;
	isDeceased: boolean;
	/** Birth and death as the original GEDCOM date text, when recorded. */
	birthDate?: string | null;
	deathDate?: string | null;
	/** Optimistic-concurrency version of the person record. */
	version?: number;
	/** The person's stored names, so the card can say "(née Simpson)". */
	names?: ReadonlyArray<{ type: string; surname: string | null; isPreferred?: boolean }>;
}

export interface GraphUnionInput {
	id: string;
	status: UnionStatus;
	marriageDate?: string | null;
	marriagePlace?: string | null;
	partnerIds: string[];
	version?: number;
	events?: GraphUnionEvent[];
	/** Epoch milliseconds the partnership was recorded. */
	createdAt?: number | null;
}

export interface GraphParentChildInput {
	parentId: string;
	childId: string;
	type: ParentChildType;
	unionId: string | null;
}

/**
 * `isPrivate` is optional on the graph types: the builder always sets it, but graphs captured
 * before Phase 3 and hand-written test graphs do not carry it, and absent means not private.
 */
export interface RelationshipGraphPerson extends Partial<PrivacyFlag> {
	id: string;
	displayName: string;
	/** Neutral sex marker, `null` when not recorded. */
	sex: Sex | null;
	isDeceased: boolean;
	/** Original date text of the first birth and death events. Absent on older captured graphs. */
	birthDate?: string | null;
	deathDate?: string | null;
	/** Version to send back when editing this person. Absent on older captured graphs. */
	version?: number;
	/** Parents grouped by union context (`__direct__` for none). */
	parentsByUnion: Record<string, Array<{ parentId: string; type: ParentChildType }>>;
	/** Union IDs this person participates in as a partner. */
	unionIds: string[];
	/** Derived step-parent relationships (parent's partner who is not a parent). */
	stepParents: Array<{ stepParentId: string; unionId: string }>;
	/**
	 * Set only by the bounded graph window, on people it names but did not fully load (a neighbour
	 * of someone drawn). Their `unionIds`, `parentsByUnion` and `stepParents` are incomplete, so
	 * nothing may treat them as the whole story; a person the view draws is never partial.
	 */
	isPartial?: true;
}

export interface RelationshipGraphUnion extends Partial<PrivacyFlag> {
	id: string;
	status: UnionStatus;
	/** Marriage/partnership date text, when recorded. */
	marriageDate: string | null;
	marriagePlace: string | null;
	partnerIds: string[];
	/** Version to send back when editing this partnership. Absent on older captured graphs. */
	version?: number;
	/** Engagement, marriage, separation, divorce and the like, in the order people read them. */
	events?: GraphUnionEvent[];
	/** Epoch milliseconds the partnership was recorded; orders undated repeated partnerships. */
	createdAt?: number | null;
	/** Children asserted within this union, with per-parent type. */
	children: Array<{ childId: string; parentId: string; type: ParentChildType }>;
}

export interface RelationshipGraph {
	people: RelationshipGraphPerson[];
	unions: RelationshipGraphUnion[];
	/** Per-parent typed assertions (edges). */
	parentChild: GraphParentChildInput[];
}

function displayName(givenName: string | null, surname: string | null, id: string, names: GraphPersonInput['names'] = []): string {
	const parts = [givenName, surname].filter(Boolean);
	const base = parts.length > 0 ? parts.join(' ') : id;
	const birth = parts.length > 0 ? birthSurnameOf(surname, names) : null;
	return birth ? `${base} (née ${birth})` : base;
}

/**
 * Build a read-only relationship graph from neutral inputs.
 *
 * Preserves every union and every per-parent assertion. Step parents are
 * derived as: for each of a child's parents, the parent's other union partners
 * who are not already recorded as the child's parents.
 */
export function buildRelationshipGraph(input: {
	people: GraphPersonInput[];
	unions: GraphUnionInput[];
	parentChild: GraphParentChildInput[];
}): RelationshipGraph {
	const personById = new Map(input.people.map((p) => [p.id, p]));
	const unionById = new Map(input.unions.map((u) => [u.id, u]));

	// Group parent-child assertions by union (and by child for lookup).
	const childrenByUnion = new Map<string, Array<{ childId: string; parentId: string; type: ParentChildType }>>();
	const parentsByChild = new Map<string, Array<{ parentId: string; type: ParentChildType; unionId: string | null }>>();
	for (const pc of input.parentChild) {
		const key = pc.unionId ?? '__direct__';
		if (!childrenByUnion.has(key)) childrenByUnion.set(key, []);
		childrenByUnion.get(key)!.push({ childId: pc.childId, parentId: pc.parentId, type: pc.type });

		if (!parentsByChild.has(pc.childId)) parentsByChild.set(pc.childId, []);
		parentsByChild.get(pc.childId)!.push({ parentId: pc.parentId, type: pc.type, unionId: pc.unionId });
	}

	const people: RelationshipGraphPerson[] = input.people.map((p) => {
		const directParents = parentsByChild.get(p.id) ?? [];
		const parentsByUnion: RelationshipGraphPerson['parentsByUnion'] = {};
		for (const pa of directParents) {
			const key = pa.unionId ?? '__direct__';
			if (!parentsByUnion[key]) parentsByUnion[key] = [];
			parentsByUnion[key].push({ parentId: pa.parentId, type: pa.type });
		}

		// Unions the person participates in as a partner.
		const unionIds = input.unions.filter((u) => u.partnerIds.includes(p.id)).map((u) => u.id);

		// Step parents: for each recorded parent, that parent's union partners
		// (in other unions) who are not themselves recorded parents of p.
		const recordedParentIds = new Set(directParents.map((pa) => pa.parentId));
		const stepParents: RelationshipGraphPerson['stepParents'] = [];
		for (const pa of directParents) {
			const parent = personById.get(pa.parentId);
			if (!parent) continue;
			const parentUnions = input.unions.filter((u) => u.partnerIds.includes(pa.parentId));
			for (const u of parentUnions) {
				for (const partnerId of u.partnerIds) {
					if (partnerId !== pa.parentId && !recordedParentIds.has(partnerId)) {
						stepParents.push({ stepParentId: partnerId, unionId: u.id });
					}
				}
			}
		}

		return {
			...privacyOf(p),
			id: p.id,
			displayName: displayName(p.givenName, p.surname, p.id, p.names),
			sex: p.sex,
			isDeceased: p.isDeceased,
			birthDate: p.birthDate ?? null,
			deathDate: p.deathDate ?? null,
			...(p.version === undefined ? {} : { version: p.version }),
			parentsByUnion,
			unionIds,
			stepParents
		};
	});

	const unions: RelationshipGraphUnion[] = input.unions.map((u) => ({
		...privacyOf(u),
		id: u.id,
		status: u.status,
		marriageDate: u.marriageDate ?? null,
		marriagePlace: u.marriagePlace ?? null,
		partnerIds: u.partnerIds,
		...(u.version === undefined ? {} : { version: u.version }),
		...(u.events === undefined ? {} : { events: u.events }),
		...(u.createdAt == null ? {} : { createdAt: u.createdAt }),
		children: childrenByUnion.get(u.id) ?? []
	}));

	return {
		people,
		unions,
		parentChild: input.parentChild
	};
}

/** True when a union is separated/divorced/annulled/ended (for legend markers). */
export function isEndedUnionStatus(status: UnionStatus): boolean {
	return status === 'separated' || status === 'divorced' || status === 'annulled' || status === 'ended';
}

/**
 * Assemble the graph from a tree snapshot. Reading and drawing use the same rows the mutations
 * plan against, so a graph fetched after a save is exactly what the save produced.
 */
export function graphFromRows(rows: TreeRows, placeholderIds: ReadonlySet<string> = new Set()): RelationshipGraph {
	const deceased = new Set(rows.events.filter((e) => e.entityType === 'INDIVIDUAL' && e.type === 'DEAT').map((e) => e.entityId));

	// The first birth and death date text per person, for card labels.
	const dates = new Map<string, { birth: string | null; death: string | null }>();
	for (const e of rows.events) {
		if (e.entityType !== 'INDIVIDUAL' || (e.type !== 'BIRT' && e.type !== 'DEAT')) continue;
		const entry = dates.get(e.entityId) ?? { birth: null, death: null };
		const key = e.type === 'BIRT' ? 'birth' : 'death';
		entry[key] ??= e.dateRaw ?? null;
		dates.set(e.entityId, entry);
	}

	const namesByPerson = new Map<string, PersonNameRow[]>();
	for (const n of rows.personNames) namesByPerson.set(n.personId, [...(namesByPerson.get(n.personId) ?? []), n]);

	const partnersByUnion = new Map<string, string[]>();
	for (const p of [...rows.unionPartners].sort((a, b) => a.order - b.order)) {
		partnersByUnion.set(p.unionId, [...(partnersByUnion.get(p.unionId) ?? []), p.personId]);
	}

	const eventsByUnion = new Map<string, GraphUnionEvent[]>();
	for (const e of rows.events) {
		if (e.entityType !== 'FAMILY' || !isUnionEventType(e.type)) continue;
		eventsByUnion.set(e.entityId, [...(eventsByUnion.get(e.entityId) ?? []), { id: e.id, type: e.type, dateText: e.dateRaw, dateSort: e.dateSort, place: e.place }]);
	}
	for (const list of eventsByUnion.values()) {
		list.sort((a, b) => UNION_EVENT_TYPE_LIST.indexOf(a.type) - UNION_EVENT_TYPE_LIST.indexOf(b.type));
	}

	const graph = buildRelationshipGraph({
		people: rows.individuals.map((i) => ({
			id: i.id,
			givenName: i.givenName,
			surname: i.surname,
			sex: (i.sex as Sex) || 'U',
			isDeceased: deceased.has(i.id),
			birthDate: dates.get(i.id)?.birth ?? null,
			deathDate: dates.get(i.id)?.death ?? null,
			version: i.version,
			names: namesByPerson.get(i.id)
		})),
		unions: rows.unions.map((u) => {
			const unionEvents = eventsByUnion.get(u.id) ?? [];
			const marriage = unionEvents.find((e) => e.type === 'MARR');
			return {
				id: u.id,
				status: u.status as UnionStatus,
				marriageDate: marriage?.dateText ?? null,
				marriagePlace: marriage?.place ?? null,
				partnerIds: partnersByUnion.get(u.id) ?? [],
				version: u.version,
				events: unionEvents,
				createdAt: u.createdAt
			};
		}),
		parentChild: rows.parentChild.map((pc) => ({
			parentId: pc.parentId,
			childId: pc.childId,
			type: pc.type as ParentChildType,
			unionId: pc.unionId
		}))
	});
	// A placeholder (privacy-mask.ts) is a person the viewer may not see: the flag is what a card
	// and a page use to draw "Private" and withhold links to a record they cannot open.
	return placeholderIds.size === 0
		? graph
		: { ...graph, people: graph.people.map((p) => (placeholderIds.has(p.id) ? { ...p, isPrivate: true } : p)) };
}
