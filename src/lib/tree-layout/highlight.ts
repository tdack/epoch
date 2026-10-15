/**
 * What a WebGL view lights: the pure model behind the focus line, a selected partnership or
 * parent-child line, and trace mode. A set of sources is walked up (ancestors) and down
 * (descendants) over the people a layout draws, and the result is three maps, person, union and
 * link, to a {@link Mark} each. The shell computes it, hands it to the scene, and the scene draws
 * it; nothing here knows about three.js.
 *
 * Rules every caller can rely on:
 * - A walk never enters a private person (ADR-015): they are not marked and a path stops at them.
 * - The focus source, and a partnership selected outside trace mode, mark everything `full`: the
 *   focus line is drawn exactly as before, and a partnership's ancestors are told apart by colour.
 *   A line, a person or any traced item draws itself and everything downstream `full`, and the
 *   path upstream `soft`.
 * - Colours are never the sex colours. A mark on two or more paths takes the intersection colour.
 */

import { HIGHLIGHT_TOKENS } from '#lib/components/tree/tree-tokens.js';
import { DEFAULT_PALETTE, type Palette } from '#lib/components/tree/palette.js';
import type { RelationshipGraphPerson } from './types.js';

/** What a layout must carry for a highlight to be computed; every WebGL layout already does. */
export interface KinSource {
	people: ReadonlyArray<{ id: string; person: RelationshipGraphPerson }>;
	unions: ReadonlyArray<{ id: string; partnerIds: readonly string[] }>;
	childLinks: ReadonlyArray<KinLink>;
}

/** A parent-child line as the layouts draw it: from a union, else from one parent's sphere. */
export interface KinLink {
	childId: string;
	fromUnionId: string | null;
	/** Set when `fromUnionId` is null. */
	fromPersonId: string | null;
	/** The drawn parents the line stands for. */
	parentIds: readonly string[];
}

/** The identity of a parent-child line, stable across layouts of the same graph. */
export function linkKey(link: Pick<KinLink, 'childId' | 'fromUnionId' | 'fromPersonId'>): string {
	return `${link.childId}<${link.fromUnionId ?? link.fromPersonId}`;
}

export type HighlightSource =
	/** Today's focus line; the partners keep the partner mark. */
	| { kind: 'focus'; personId: string }
	/**
	 * A partnership. Split, each partner's ancestors take that partner's own palette colour and
	 * the descendants the descendant colour; unsplit (trace mode), the whole source has one colour.
	 */
	| { kind: 'union'; unionId: string; shouldSplitPartners: boolean }
	/** A parent-child line; `key` is a {@link linkKey}. */
	| { kind: 'link'; key: string }
	/** A person traced on their own: their ancestors soft, their descendants full. */
	| { kind: 'person'; personId: string };

type MarkKind = 'self' | 'ancestor' | 'descendant' | 'partner';

export interface Mark {
	colour: string;
	/** `full` for the item itself and what is downstream; `soft` for the path upstream. */
	strength: 'full' | 'soft';
	kind: MarkKind;
	/** On two or more paths, which is what takes the intersection colour. */
	isShared: boolean;
	/** Indexes into {@link Highlight.sources} of every source that reached this item. */
	sourceIndexes: readonly number[];
}

export interface Highlight {
	people: ReadonlyMap<string, Mark>;
	unions: ReadonlyMap<string, Mark>;
	/** Keyed by {@link linkKey}. */
	links: ReadonlyMap<string, Mark>;
	/** The sources that were used, in order, each with the colour its chip shows. */
	sources: ReadonlyArray<{ source: HighlightSource; colour: string }>;
	/** True for trace mode, where every source has a colour of its own. */
	isTrace: boolean;
	/** Nothing lit: draw everyone alike. */
	isQuiet: boolean;
}

/** Trace mode holds this many items: the number of colours a viewer can tell apart. */
export const MAX_TRACE_ITEMS = HIGHLIGHT_TOKENS.trace.length;

export const QUIET_HIGHLIGHT: Highlight = {
	people: new Map(),
	unions: new Map(),
	links: new Map(),
	sources: [],
	isTrace: false,
	isQuiet: true
};

/** The identity of a source, so trace mode can tell "already added" from "new". */
export function sourceKey(source: HighlightSource): string {
	switch (source.kind) {
		case 'focus':
		case 'person':
			return `person:${source.personId}`;
		case 'union':
			return `union:${source.unionId}`;
		case 'link':
			return `link:${source.key}`;
	}
}

type TraceChange =
	| { result: 'added' | 'removed'; items: HighlightSource[] }
	| { result: 'full'; items: HighlightSource[] };

/** Adds the item, or removes it if already traced; a seventh item adds nothing and says so. */
export function toggleTraceItem(
	items: readonly HighlightSource[],
	source: HighlightSource
): TraceChange {
	const key = sourceKey(source);
	if (items.some((item) => sourceKey(item) === key))
		return { result: 'removed', items: items.filter((item) => sourceKey(item) !== key) };
	if (items.length >= MAX_TRACE_ITEMS) return { result: 'full', items: [...items] };
	return { result: 'added', items: [...items, source] };
}

/** Whether the layout still draws what the source names; a source that is not has nothing to light. */
export function isSourcePresent(kin: KinSource, source: HighlightSource): boolean {
	switch (source.kind) {
		case 'focus':
		case 'person':
			return kin.people.some((p) => p.id === source.personId);
		case 'union':
			return kin.unions.some((u) => u.id === source.unionId);
		case 'link':
			return kin.childLinks.some((l) => linkKey(l) === source.key);
	}
}

/** One colour-and-direction of one source; sharing is counted between walkers, not sources. */
interface Walker {
	sourceIndex: number;
	colour: string;
}

interface Contribution {
	walker: number;
	kind: MarkKind;
	strength: 'full' | 'soft';
	colour: string;
}

const KIND_RANK: Record<MarkKind, number> = { self: 0, ancestor: 1, descendant: 2, partner: 3 };

interface Graph {
	isPrivate: (id: string) => boolean;
	linksOfChild: Map<string, KinLink[]>;
	linksOfParent: Map<string, KinLink[]>;
	linksOfUnion: Map<string, KinLink[]>;
	partnersOfUnion: Map<string, readonly string[]>;
	unionsOfPerson: Map<string, string[]>;
	linkByKey: Map<string, KinLink>;
}

function indexKin(kin: KinSource): Graph {
	const privateIds = new Set(
		kin.people.filter((p) => p.person.isPrivate === true).map((p) => p.id)
	);
	const push = <K>(map: Map<K, KinLink[]>, key: K, link: KinLink) => {
		const list = map.get(key);
		if (list) list.push(link);
		else map.set(key, [link]);
	};
	const linksOfChild = new Map<string, KinLink[]>();
	const linksOfParent = new Map<string, KinLink[]>();
	const linksOfUnion = new Map<string, KinLink[]>();
	const linkByKey = new Map<string, KinLink>();
	for (const link of kin.childLinks) {
		linkByKey.set(linkKey(link), link);
		push(linksOfChild, link.childId, link);
		for (const parentId of link.parentIds) push(linksOfParent, parentId, link);
		if (link.fromUnionId !== null) push(linksOfUnion, link.fromUnionId, link);
	}
	const unionsOfPerson = new Map<string, string[]>();
	for (const union of kin.unions)
		for (const id of union.partnerIds)
			unionsOfPerson.set(id, [...(unionsOfPerson.get(id) ?? []), union.id]);
	return {
		isPrivate: (id) => privateIds.has(id),
		linksOfChild,
		linksOfParent,
		linksOfUnion,
		partnersOfUnion: new Map(kin.unions.map((u) => [u.id, u.partnerIds])),
		unionsOfPerson,
		linkByKey
	};
}

/**
 * Computes what the sources light. In trace mode (`isTrace`) source `i` takes the `i`th trace
 * colour for everything it reaches and at most {@link MAX_TRACE_ITEMS} sources count. Otherwise
 * each source uses the colours its kind implies (the focus line's, or the partners' palette).
 * Sources the layout does not draw, and private people, light nothing.
 */
export function computeHighlight(
	kin: KinSource,
	allSources: readonly HighlightSource[],
	isTrace = false,
	palette: Palette = DEFAULT_PALETTE
): Highlight {
	const graph = indexKin(kin);
	const sources = (isTrace ? allSources.slice(0, MAX_TRACE_ITEMS) : allSources).filter((s) =>
		isSourcePresent(kin, s)
	);
	const walkers: Walker[] = [];
	const people = new Map<string, Contribution[]>();
	const unions = new Map<string, Contribution[]>();
	const links = new Map<string, Contribution[]>();
	const partners = new Map<string, Contribution>();
	const chipColours: string[] = [];

	const add = (map: Map<string, Contribution[]>, id: string, c: Contribution) => {
		const list = map.get(id);
		if (!list) map.set(id, [c]);
		else if (!list.some((o) => o.walker === c.walker && o.kind === c.kind)) list.push(c);
	};
	const newWalker = (sourceIndex: number, colour: string) => {
		walkers.push({ sourceIndex, colour });
		return walkers.length - 1;
	};

	/** Marks the people, unions and links upstream of a person, walker by walker. */
	function walkUp(from: string, walker: number, strength: 'full' | 'soft', isFocus: boolean) {
		const colour = walkers[walker].colour;
		const seen = new Set([from]);
		const stack = [from];
		while (stack.length > 0)
			for (const link of graph.linksOfChild.get(stack.pop()!) ?? []) {
				const parents = link.parentIds.filter((id) => !graph.isPrivate(id));
				if (parents.length === 0) continue;
				add(links, linkKey(link), { walker, kind: 'ancestor', strength, colour });
				if (link.fromUnionId !== null && !isFocus)
					add(unions, link.fromUnionId, { walker, kind: 'ancestor', strength, colour });
				for (const parentId of parents)
					if (!seen.has(parentId)) {
						seen.add(parentId);
						add(people, parentId, { walker, kind: 'ancestor', strength, colour });
						stack.push(parentId);
					}
			}
	}

	/** Marks everything downstream of these lines (and of the people who are their parents). */
	function walkDown(
		seedLinks: KinLink[],
		walker: number,
		isFocus: boolean,
		shouldMarkSeedUnions = true
	) {
		const colour = walkers[walker].colour;
		const seenLinks = new Set<string>();
		const seenPeople = new Set<string>();
		const stack = [...seedLinks];
		const seedKeys = new Set(seedLinks.map(linkKey));
		while (stack.length > 0) {
			const link = stack.pop()!;
			const key = linkKey(link);
			if (seenLinks.has(key) || graph.isPrivate(link.childId)) continue;
			seenLinks.add(key);
			add(links, key, { walker, kind: 'descendant', strength: 'full', colour });
			if (link.fromUnionId !== null && !isFocus && (shouldMarkSeedUnions || !seedKeys.has(key)))
				add(unions, link.fromUnionId, { walker, kind: 'descendant', strength: 'full', colour });
			if (seenPeople.has(link.childId)) continue;
			seenPeople.add(link.childId);
			add(people, link.childId, { walker, kind: 'descendant', strength: 'full', colour });
			stack.push(...(graph.linksOfParent.get(link.childId) ?? []));
		}
	}

	function markPartners(personId: string, walker: number) {
		for (const unionId of graph.unionsOfPerson.get(personId) ?? [])
			for (const id of graph.partnersOfUnion.get(unionId) ?? [])
				if (id !== personId && !graph.isPrivate(id) && !partners.has(id))
					partners.set(id, {
						walker,
						kind: 'partner',
						strength: 'full',
						colour: palette.focus.partner
					});
	}

	sources.forEach((source, index) => {
		const traceColour = palette.trace[index];
		const colourOf = (fallback: string) => (isTrace ? traceColour : fallback);
		switch (source.kind) {
			case 'focus': {
				if (graph.isPrivate(source.personId)) {
					chipColours.push(traceColour);
					return;
				}
				const up = newWalker(index, colourOf(palette.focus.ancestor));
				const down = newWalker(index, colourOf(palette.focus.descendant));
				chipColours.push(walkers[down].colour);
				add(people, source.personId, {
					walker: down,
					kind: 'self',
					strength: 'full',
					colour: walkers[down].colour
				});
				// Focus is `full` all the way up: today's line has no soft half.
				walkUp(source.personId, up, 'full', true);
				walkDown(graph.linksOfParent.get(source.personId) ?? [], down, true);
				markPartners(source.personId, down);
				break;
			}
			case 'person': {
				if (graph.isPrivate(source.personId)) {
					chipColours.push(traceColour);
					return;
				}
				const up = newWalker(index, colourOf(palette.focus.ancestor));
				const down = newWalker(index, colourOf(palette.focus.descendant));
				chipColours.push(walkers[down].colour);
				add(people, source.personId, {
					walker: down,
					kind: 'self',
					strength: 'full',
					colour: walkers[down].colour
				});
				walkUp(source.personId, up, 'soft', false);
				walkDown(graph.linksOfParent.get(source.personId) ?? [], down, false);
				break;
			}
			case 'union': {
				const partnerIds = (graph.partnersOfUnion.get(source.unionId) ?? []).filter(
					(id) => !graph.isPrivate(id)
				);
				const all = graph.partnersOfUnion.get(source.unionId) ?? [];
				const down = newWalker(index, colourOf(palette.focus.descendant));
				chipColours.push(walkers[down].colour);
				add(unions, source.unionId, {
					walker: down,
					kind: 'self',
					strength: 'full',
					colour: isTrace ? traceColour : palette.focus.partner
				});
				const isSplit = source.shouldSplitPartners && !isTrace;
				// One walker per partner when split, so cousins marrying shows as a shared ancestor.
				const shared = isSplit ? null : newWalker(index, colourOf(palette.focus.ancestor));
				for (const partnerId of partnerIds) {
					const walker =
						shared ?? newWalker(index, palette.trace[all.indexOf(partnerId) % MAX_TRACE_ITEMS]);
					add(people, partnerId, {
						walker,
						kind: 'self',
						strength: 'full',
						colour: walkers[walker].colour
					});
					walkUp(partnerId, walker, isTrace ? 'soft' : 'full', false);
				}
				walkDown(graph.linksOfUnion.get(source.unionId) ?? [], down, false);
				break;
			}
			case 'link': {
				const link = graph.linkByKey.get(source.key)!;
				const up = newWalker(index, colourOf(palette.focus.ancestor));
				const down = newWalker(index, colourOf(palette.focus.descendant));
				chipColours.push(walkers[down].colour);
				if (graph.isPrivate(link.childId)) return;
				add(links, source.key, {
					walker: down,
					kind: 'self',
					strength: 'full',
					colour: walkers[down].colour
				});
				if (link.fromUnionId !== null)
					add(unions, link.fromUnionId, {
						walker: up,
						kind: 'ancestor',
						strength: 'soft',
						colour: walkers[up].colour
					});
				for (const parentId of link.parentIds) {
					if (graph.isPrivate(parentId)) continue;
					add(people, parentId, {
						walker: up,
						kind: 'ancestor',
						strength: 'soft',
						colour: walkers[up].colour
					});
					walkUp(parentId, up, 'soft', false);
				}
				// The line's own partnership is upstream of it, already marked by the upward walk.
				walkDown([link], down, false, false);
				break;
			}
		}
	});

	const merge = (map: Map<string, Contribution[]>): Map<string, Mark> => {
		const marks = new Map<string, Mark>();
		for (const [id, contributions] of map) {
			const distinctWalkers = new Set(contributions.map((c) => c.walker));
			const isShared = distinctWalkers.size >= 2;
			const best = [...contributions].sort((a, b) => KIND_RANK[a.kind] - KIND_RANK[b.kind])[0];
			marks.set(id, {
				colour: isShared ? palette.intersection : best.colour,
				strength: contributions.some((c) => c.strength === 'full') ? 'full' : 'soft',
				kind: best.kind,
				isShared,
				sourceIndexes: [...new Set(contributions.map((c) => walkers[c.walker].sourceIndex))].sort(
					(a, b) => a - b
				)
			});
		}
		return marks;
	};

	const peopleMarks = merge(people);
	// Partners only light when nothing else already did.
	for (const [id, c] of partners)
		if (!peopleMarks.has(id))
			peopleMarks.set(id, {
				colour: c.colour,
				strength: 'full',
				kind: 'partner',
				isShared: false,
				sourceIndexes: [walkers[c.walker].sourceIndex]
			});
	const unionMarks = merge(unions);
	// The focus line lights a partnership when one of its partners is on the line, in the partner
	// colour, as the scenes always have.
	if (sources.some((s) => s.kind === 'focus'))
		for (const union of kin.unions) {
			if (unionMarks.has(union.id)) continue;
			const onLine = union.partnerIds.find((id) => {
				const m = peopleMarks.get(id);
				return m !== undefined && m.kind !== 'partner';
			});
			if (onLine !== undefined)
				unionMarks.set(union.id, {
					colour: palette.focus.partner,
					strength: 'full',
					kind: 'partner',
					isShared: false,
					sourceIndexes: peopleMarks.get(onLine)!.sourceIndexes
				});
		}
	const linkMarks = merge(links);
	return {
		people: peopleMarks,
		unions: unionMarks,
		links: linkMarks,
		sources: sources.map((source, i) => ({ source, colour: chipColours[i] })),
		isTrace,
		isQuiet: peopleMarks.size === 0 && unionMarks.size === 0 && linkMarks.size === 0
	};
}
