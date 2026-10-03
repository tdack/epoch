/**
 * How two people are related, and the routes that say so (Phase 3 item 8). Pure: it works on the
 * parent links and partnerships it is handed, so the same code runs over a window loaded from D1
 * and over a hand-written fixture, and what a viewer may see is decided before it is called.
 *
 * Every route is reported, not the shortest one: a pedigree that loops back on itself, or a couple
 * who are also cousins, has more than one, and each says which links it runs through.
 *
 * Blood routes go up from each person to a common ancestor. Of the common ancestors only the
 * lowest count (one that is not itself an ancestor of another common ancestor), because anything
 * above them is the same relationship seen from further away. Two lowest ancestors who are parents
 * of the same child are one couple and one route, which is what makes a sibling "full" and not "half".
 * A partner of the other person's relative, or a relative of their partner, is a route by
 * partnership. It is withheld only for a direct-line relative (a grandfather is his wife's partner, but
 * that says nothing new); a step-parent who is also a cousin has both routes.
 */

import type { Sex } from '../../shared/sex';
import type { ParentChildType } from '../../shared/relationship-model';

interface KinLink {
	parentId: string;
	childId: string;
	type: ParentChildType;
}

interface KinPerson {
	name: string;
	sex: Sex | null;
	isPrivate: boolean;
}

export interface KinGraph {
	people: ReadonlyMap<string, KinPerson>;
	links: readonly KinLink[];
	/** Each person's partners, both directions; a partnership is not inferred to mean marriage. */
	partners: ReadonlyMap<string, readonly string[]>;
}

const ROUTE_KINDS = {
	SELF: 'self',
	PARTNER: 'partner',
	BLOOD: 'blood',
	BY_PARTNERSHIP: 'by-partnership'
} as const;
type RouteKind = (typeof ROUTE_KINDS)[keyof typeof ROUTE_KINDS];

const STEP_RELATIONS = { PARENT: 'parent', CHILD: 'child', PARTNER: 'partner' } as const;
type StepRelation = (typeof STEP_RELATIONS)[keyof typeof STEP_RELATIONS];

interface RouteStep {
	personId: string;
	/** What this person is to the previous one in the route; null for the first person. */
	relation: StepRelation | null;
	/** The type of the parent-child link, for a parent or child step. */
	linkType: ParentChildType | null;
}

interface Route {
	kind: RouteKind;
	/** What the second person is to the first, e.g. "2nd cousin once removed". */
	label: string;
	steps: RouteStep[];
	/** The lowest common ancestors the route runs through; empty for a partnership. */
	viaIds: string[];
	/** Parent-child link types on the route that are not biological, so the label can say so. */
	nonBiologicalTypes: ParentChildType[];
	/** Generations from the first person up to the common ancestor, and from the second. */
	generations: { fromFirst: number; fromSecond: number } | null;
}

export interface RelationshipResult {
	routes: Route[];
	/** True when the search stopped at its limit before it could rule a relationship out. */
	isIncomplete: boolean;
}

/** Generations to look up from each person; deeper than any real pedigree needs, and a guard. */
export const MAX_GENERATIONS = 20;
const MAX_ROUTES = 8;

interface Ancestry {
	/** Generations up from the start person; the person themselves are at 0. */
	distance: Map<string, number>;
	/** For each ancestor, the link to the person one step closer to the start, along a shortest way up. */
	via: Map<string, KinLink>;
}

function ancestryOf(startId: string, parentsOf: Map<string, KinLink[]>): Ancestry {
	const distance = new Map([[startId, 0]]);
	const via = new Map<string, KinLink>();
	let frontier = [startId];
	for (let depth = 1; frontier.length > 0 && depth <= MAX_GENERATIONS; depth++) {
		const next: string[] = [];
		for (const id of frontier) {
			for (const link of parentsOf.get(id) ?? []) {
				if (distance.has(link.parentId)) continue;
				distance.set(link.parentId, depth);
				via.set(link.parentId, link);
				next.push(link.parentId);
			}
		}
		frontier = next;
	}
	return { distance, via };
}

/** The people above `id`, nearest first, not including `id`. */
function ancestorsAbove(id: string, parentsOf: Map<string, KinLink[]>): Set<string> {
	const seen = new Set<string>();
	const stack = [id];
	while (stack.length > 0) {
		for (const link of parentsOf.get(stack.pop()!) ?? []) {
			if (!seen.has(link.parentId)) {
				seen.add(link.parentId);
				stack.push(link.parentId);
			}
		}
	}
	return seen;
}

const ordinal = (n: number) =>
	`${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][n % 10] ?? 'th')}`;
const times = (n: number) => (n === 1 ? 'once' : n === 2 ? 'twice' : `${n} times`);
const greats = (n: number) => 'great-'.repeat(Math.max(0, n));

/** A direct line: B is `n` generations above (`isUp`) or below A. */
function lineLabel(n: number, isUp: boolean, sex: Sex | null): string {
	const [base, grand] = isUp
		? sex === 'M'
			? ['father', 'grandfather']
			: sex === 'F'
				? ['mother', 'grandmother']
				: ['parent', 'grandparent']
		: sex === 'M'
			? ['son', 'grandson']
			: sex === 'F'
				? ['daughter', 'granddaughter']
				: ['child', 'grandchild'];
	if (n === 1) return base!;
	return `${greats(n - 2)}${grand}`;
}

/**
 * What B is to A, when A is `fromFirst` generations below their lowest common ancestor and B is
 * `fromSecond`. A sex of M or F gives the gendered word; anything else the neutral one, because the
 * model records sex as a fact and not as a role.
 */
export function kinLabel(
	fromFirst: number,
	fromSecond: number,
	sexOfSecond: Sex | null,
	isFull = true
): string {
	if (fromFirst === 0 && fromSecond === 0) return 'the same person';
	if (fromSecond === 0) return lineLabel(fromFirst, true, sexOfSecond);
	if (fromFirst === 0) return lineLabel(fromSecond, false, sexOfSecond);
	const isGendered = sexOfSecond === 'M' || sexOfSecond === 'F';
	if (fromFirst === 1 && fromSecond === 1) {
		const sibling = sexOfSecond === 'M' ? 'brother' : sexOfSecond === 'F' ? 'sister' : 'sibling';
		return isFull ? sibling : `half-${sibling}`;
	}
	if (fromFirst === 1) {
		// B descends from A's sibling.
		if (!isGendered) return `sibling's ${lineLabel(fromSecond - 1, false, null)}`;
		const base = sexOfSecond === 'M' ? 'nephew' : 'niece';
		return fromSecond === 2 ? base : `${greats(fromSecond - 3)}grand${base}`;
	}
	if (fromSecond === 1) {
		// B is a sibling of A's ancestor.
		if (!isGendered) return `${lineLabel(fromFirst - 1, true, null)}'s sibling`;
		const base = sexOfSecond === 'M' ? 'uncle' : 'aunt';
		return `${greats(fromFirst - 2)}${base}`;
	}
	const degree = Math.min(fromFirst, fromSecond) - 1;
	const removed = Math.abs(fromFirst - fromSecond);
	return `${ordinal(degree)} cousin${removed > 0 ? ` ${times(removed)} removed` : ''}`;
}

const isBiological = (type: ParentChildType) => type === 'biological';

interface Chain {
	steps: RouteStep[];
	types: ParentChildType[];
}

/** From `startId` up to `topId`: the steps A, parent, grandparent, ..., top, each a parent step. */
function upChain(startId: string, topId: string, ancestry: Ancestry): Chain {
	const reversed: RouteStep[] = [];
	const types: ParentChildType[] = [];
	for (let id = topId; id !== startId;) {
		const link = ancestry.via.get(id)!;
		reversed.push({ personId: id, relation: STEP_RELATIONS.PARENT, linkType: link.type });
		types.push(link.type);
		id = link.childId;
	}
	return {
		steps: [{ personId: startId, relation: null, linkType: null }, ...reversed.reverse()],
		types
	};
}

/** The same chain walked the other way, from `topId` down to `startId`: each step a child step. */
function downChain(startId: string, topId: string, ancestry: Ancestry): Chain {
	const steps: RouteStep[] = [];
	const types: ParentChildType[] = [];
	for (let id = topId; id !== startId;) {
		const link = ancestry.via.get(id)!;
		steps.push({ personId: link.childId, relation: STEP_RELATIONS.CHILD, linkType: link.type });
		types.push(link.type);
		id = link.childId;
	}
	return { steps, types };
}

/** Blood routes from `firstId` to `secondId`; empty when they share no ancestor within the limit. */
function bloodRoutes(
	firstId: string,
	secondId: string,
	graph: KinGraph,
	parentsOf: Map<string, KinLink[]>,
	childrenOf: Map<string, Set<string>>
): Route[] {
	const first = ancestryOf(firstId, parentsOf);
	const second = ancestryOf(secondId, parentsOf);
	const common = [...first.distance.keys()].filter((id) => second.distance.has(id));
	// Only the lowest: a common ancestor that is an ancestor of another common ancestor is the same
	// relationship, seen from further up.
	const dominated = new Set<string>();
	for (const id of common)
		for (const above of ancestorsAbove(id, parentsOf))
			if (common.includes(above)) dominated.add(above);
	const lowest = common
		.filter((id) => !dominated.has(id))
		.sort(
			(x, y) =>
				first.distance.get(x)! +
					second.distance.get(x)! -
					(first.distance.get(y)! + second.distance.get(y)!) || x.localeCompare(y)
		);

	const routes: Route[] = [];
	const used = new Set<string>();
	for (const id of lowest) {
		if (used.has(id)) continue;
		used.add(id);
		const fromFirst = first.distance.get(id)!;
		const fromSecond = second.distance.get(id)!;
		// Two lowest ancestors at the same distance who share a child are one couple: one route.
		const partner = lowest.find(
			(other) =>
				!used.has(other) &&
				first.distance.get(other) === fromFirst &&
				second.distance.get(other) === fromSecond &&
				[...(childrenOf.get(id) ?? [])].some((c) => childrenOf.get(other)?.has(c))
		);
		if (partner) used.add(partner);
		const up = upChain(firstId, id, first);
		const down = downChain(secondId, id, second);
		const nonBiological = [
			...new Set([...up.types, ...down.types].filter((t) => !isBiological(t)))
		];
		routes.push({
			kind: ROUTE_KINDS.BLOOD,
			label: kinLabel(
				fromFirst,
				fromSecond,
				graph.people.get(secondId)?.sex ?? null,
				partner !== undefined || !(fromFirst === 1 && fromSecond === 1)
			),
			steps: [...up.steps, ...down.steps],
			viaIds: partner ? [id, partner] : [id],
			nonBiologicalTypes: nonBiological,
			generations: { fromFirst, fromSecond }
		});
	}
	return routes;
}

/**
 * Every way `secondId` is related to `firstId`, best first: the same person, a partner, blood
 * relatives (nearest first), then a relative of a partner or a partner of
 * a relative, unless the second person is a direct-line relative of the first.
 * `isIncomplete` is set when a pedigree reached the generation limit.
 */
export function findRelationships(
	firstId: string,
	secondId: string,
	graph: KinGraph
): RelationshipResult {
	if (firstId === secondId) {
		return {
			routes: [
				{
					kind: ROUTE_KINDS.SELF,
					label: 'the same person',
					steps: [{ personId: firstId, relation: null, linkType: null }],
					viaIds: [],
					nonBiologicalTypes: [],
					generations: null
				}
			],
			isIncomplete: false
		};
	}
	const parentsOf = new Map<string, KinLink[]>();
	const childrenOf = new Map<string, Set<string>>();
	for (const link of graph.links) {
		(parentsOf.get(link.childId) ?? parentsOf.set(link.childId, []).get(link.childId)!).push(link);
		(
			childrenOf.get(link.parentId) ?? childrenOf.set(link.parentId, new Set()).get(link.parentId)!
		).add(link.childId);
	}
	const routes: Route[] = [];

	if (graph.partners.get(firstId)?.includes(secondId)) {
		routes.push({
			kind: ROUTE_KINDS.PARTNER,
			label: 'partner',
			steps: [
				{ personId: firstId, relation: null, linkType: null },
				{ personId: secondId, relation: STEP_RELATIONS.PARTNER, linkType: null }
			],
			viaIds: [],
			nonBiologicalTypes: [],
			generations: null
		});
	}

	const blood = bloodRoutes(firstId, secondId, graph, parentsOf, childrenOf).sort(
		(a, b) =>
			a.generations!.fromFirst +
			a.generations!.fromSecond -
			(b.generations!.fromFirst + b.generations!.fromSecond)
	);
	routes.push(...blood);

	// A relative in a direct line is already a parent's, grandparent's or child's partner by being one,
	// and a step-parent is a parent's partner who is *not* a parent, so a direct-line relative must not
	// also be reported by partnership. Every other route by partnership is offered beside any blood route.
	const isDirectLine = blood.some(
		(r) => r.generations!.fromFirst === 0 || r.generations!.fromSecond === 0
	);
	if (!isDirectLine) {
		const sexOf = (id: string) => graph.people.get(id)?.sex ?? null;
		const viaSecond = (graph.partners.get(secondId) ?? [])
			.filter((p) => p !== firstId)
			.flatMap((partnerId) =>
				bloodRoutes(firstId, partnerId, graph, parentsOf, childrenOf).map((route): Route => {
					const kin = kinLabel(
						route.generations!.fromFirst,
						route.generations!.fromSecond,
						sexOf(partnerId),
						true
					);
					const label =
						kin === 'parent' || kin === 'father' || kin === 'mother'
							? 'step-parent'
							: kin === 'child' || kin === 'son' || kin === 'daughter'
								? 'child-in-law'
								: /^(brother|sister|sibling)$/.test(kin)
									? 'sibling-in-law'
									: `partner of ${kin}`;
					return {
						...route,
						kind: ROUTE_KINDS.BY_PARTNERSHIP,
						label,
						steps: [
							...route.steps,
							{ personId: secondId, relation: STEP_RELATIONS.PARTNER, linkType: null }
						]
					};
				})
			);
		const viaFirst = (graph.partners.get(firstId) ?? [])
			.filter((p) => p !== secondId)
			.flatMap((partnerId) =>
				bloodRoutes(partnerId, secondId, graph, parentsOf, childrenOf).map((route): Route => {
					const kin = kinLabel(
						route.generations!.fromFirst,
						route.generations!.fromSecond,
						sexOf(secondId),
						true
					);
					const label =
						kin === 'parent' || kin === 'father' || kin === 'mother'
							? 'parent-in-law'
							: kin === 'child' || kin === 'son' || kin === 'daughter'
								? 'step-child'
								: /^(brother|sister|sibling)$/.test(kin)
									? 'sibling-in-law'
									: `${kin} of partner`;
					return {
						...route,
						kind: ROUTE_KINDS.BY_PARTNERSHIP,
						label,
						steps: [
							{ personId: firstId, relation: null, linkType: null },
							{ personId: partnerId, relation: STEP_RELATIONS.PARTNER, linkType: null },
							...route.steps.slice(1)
						]
					};
				})
			);
		routes.push(...[...viaSecond, ...viaFirst].sort((a, b) => a.steps.length - b.steps.length));
	}

	const isLimitReached = [firstId, secondId].some(
		(id) => Math.max(...ancestryOf(id, parentsOf).distance.values()) >= MAX_GENERATIONS
	);
	return {
		routes: routes.slice(0, MAX_ROUTES),
		isIncomplete: routes.length === 0 && isLimitReached
	};
}
