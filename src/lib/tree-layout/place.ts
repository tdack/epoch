/**
 * Hourglass placement. Partners are grouped into couple blocks (a chain of cards with the union
 * node between adjacent partners); blocks form a tree in each direction from the focus row:
 * descendants hang below their union, ancestors above their child. Subtrees are separated
 * row by row using contours, so the result has no overlaps and is exactly reproducible.
 *
 * Coordinates inside a subtree are relative to a reference x (the anchor card for descendant
 * blocks, the centre of the parent blocks for ancestors) and are shifted as subtrees are joined.
 */

import { contourAdd, contourMerge, contourSeparation, type Contour } from './contour.js';
import type { GraphIndex } from './graph-index.js';
import {
	LAYOUT_METRICS,
	PERSON_ROLES,
	type FocusSelection,
	type LayoutMetrics,
	type RelationshipGraphUnion
} from './types.js';

export type Item =
	| { t: 'person'; id: string; gen: number; x: number }
	| { t: 'union'; id: string; gen: number; x: number; isHanging: boolean }
	| { t: 'stub'; id: string; gen: number; x: number };

interface Sub {
	items: Item[];
	contour: Contour;
}

export interface Placement {
	items: Item[];
	/** `${unionId}|${childId}` and `direct|${parentId}|${childId}` for edges that carry placement. */
	primaryEdgeKeys: Set<string>;
	nonAdjacentUnionIds: string[];
}

interface Context {
	index: GraphIndex;
	selection: FocusSelection;
	m: LayoutMetrics;
	genOf: Map<string, number>;
	unionIds: Set<string>;
	stubIds: Set<string>;
	/** People already given a card; a person is drawn once. */
	placed: Set<string>;
	/** Unions already used as some drawn person's parent union. */
	claimedParentUnions: Set<string>;
	primaryEdgeKeys: Set<string>;
	nonAdjacent: Set<string>;
	/** Anchor parent of each drawn child (`stepChildAnchor`); the group holding it claims the child. */
	anchorOf: Map<string, string>;
	/** Anchors that can never claim children because ancestor cards are placed by `layoutParents`. */
	ancestorIds: Set<string>;
}

function shiftItems(items: Item[], dx: number): Item[] {
	return items.map((item) => ({ ...item, x: item.x + dx }));
}

function unique<T>(values: T[]): T[] {
	return [...new Set(values)];
}

/** Offsets placing subs left to right; each keeps `gap` from everything placed before it. */
function sequenceOffsets(subs: Sub[], gap: number, minPitch = 0): number[] {
	const accumulated: Contour = new Map();
	const offsets: number[] = [];
	subs.forEach((sub, i) => {
		let offset = 0;
		if (i > 0) {
			const separation = contourSeparation(accumulated, sub.contour, gap);
			offset = Math.max(offsets[i - 1] + minPitch, Number.isFinite(separation) ? separation : 0);
		}
		offsets.push(offset);
		contourMerge(accumulated, sub.contour, offset);
	});
	return offsets;
}

// ---- Couple chains ----

interface Chain {
	cards: string[];
	unions: Array<{ union: RelationshipGraphUnion; cardIdxs: number[]; hasMissingPartner: boolean }>;
}

/**
 * Order the partners of `unions` into one row. With a single couple union the partner goes to
 * `hint`'s side (right unless the person leads a sibling group); with several, the first union's
 * partners go left and the rest right, so chronology reads left to right around the anchor.
 */
function arrangeChain(
	ctx: Context,
	anchorId: string,
	unions: RelationshipGraphUnion[],
	hint: 'left' | 'right',
	viaPartner: Map<string, string> = new Map()
): Chain {
	const row = ctx.genOf.get(anchorId)!;
	const inChain = new Set([anchorId]);
	const freshPartners = (union: RelationshipGraphUnion) => {
		const fresh = unique(union.partnerIds).filter(
			(id) => !inChain.has(id) && !ctx.placed.has(id) && ctx.genOf.get(id) === row
		);
		for (const id of fresh) inChain.add(id);
		return fresh;
	};
	const ownUnions = unions.filter((u) => !viaPartner.has(u.id));
	const newPartners = ownUnions.map(freshPartners);
	const coupleCount = newPartners.filter((p) => p.length > 0).length;
	const left: string[] = [];
	const right: string[] = [];
	let seen = 0;
	for (const fresh of newPartners) {
		if (fresh.length === 0) continue;
		const isLeft = coupleCount >= 2 ? seen === 0 : hint === 'left';
		(isLeft ? left : right).push(...fresh);
		seen++;
	}
	// A partner's other families extend the row outward from that partner, so the partner stays
	// between their unions instead of the anchor being wedged between two strangers.
	for (const union of unions) {
		const owner = viaPartner.get(union.id);
		if (owner === undefined) continue;
		const fresh = freshPartners(union);
		if (fresh.length === 0) continue;
		if (left.includes(owner)) left.unshift(...fresh);
		else right.push(...fresh);
	}
	const cards = [...left, anchorId, ...right];
	for (const id of cards) ctx.placed.add(id);

	return {
		cards,
		unions: unions.map((union) => {
			const partners = unique(union.partnerIds);
			const cardIdxs = partners
				.map((id) => cards.indexOf(id))
				.filter((i) => i >= 0)
				.sort((a, b) => a - b);
			const hasMissingPartner = cardIdxs.length < partners.length;
			const isAdjacent = cardIdxs.every((idx, i) => i === 0 || idx === cardIdxs[i - 1] + 1);
			if (hasMissingPartner || (cardIdxs.length >= 2 && !isAdjacent)) ctx.nonAdjacent.add(union.id);
			return { union, cardIdxs, hasMissingPartner };
		})
	};
}

/**
 * The anchor's drawn unions plus, transitively, the other drawn unions of their partners, so a
 * partner's own family is placed with the couple. Each extra union records the partner it
 * belongs to.
 */
function chainUnions(ctx: Context, anchorId: string) {
	const row = ctx.genOf.get(anchorId)!;
	const drawn = (id: string) =>
		(ctx.index.unionsOfPerson.get(id) ?? []).filter((u) => ctx.unionIds.has(u.id));
	const unions = drawn(anchorId);
	const seenUnions = new Set(unions.map((u) => u.id));
	const viaPartner = new Map<string, string>();
	const queue = unions.flatMap((u) => unique(u.partnerIds)).filter((id) => id !== anchorId);
	const queued = new Set([anchorId, ...queue]);
	while (queue.length > 0) {
		const personId = queue.shift()!;
		if (ctx.genOf.get(personId) !== row || ctx.placed.has(personId)) continue;
		for (const union of drawn(personId)) {
			if (seenUnions.has(union.id)) continue;
			seenUnions.add(union.id);
			unions.push(union);
			viaPartner.set(union.id, personId);
			for (const id of unique(union.partnerIds)) {
				if (!queued.has(id)) {
					queued.add(id);
					queue.push(id);
				}
			}
		}
	}
	return { unions, viaPartner };
}

/** Which unions sit between two adjacent cards; repeated unions past the first hang below. */
function classifyUnions(
	chain: Chain
): Array<{ id: string; cardIdxs: number[]; gapIdx: number | null }> {
	const usedGaps = new Set<number>();
	return chain.unions.map(({ union, cardIdxs, hasMissingPartner }) => {
		const isPair = cardIdxs.length === 2 && cardIdxs[1] === cardIdxs[0] + 1 && !hasMissingPartner;
		if (isPair && !usedGaps.has(cardIdxs[0])) {
			usedGaps.add(cardIdxs[0]);
			return { id: union.id, cardIdxs, gapIdx: cardIdxs[0] };
		}
		return { id: union.id, cardIdxs, gapIdx: null };
	});
}

function cardPositions(
	count: number,
	anchorIdx: number,
	gaps: number[],
	m: LayoutMetrics
): number[] {
	const xs = [0];
	for (let j = 1; j < count; j++) xs.push(xs[j - 1] + m.cardWidth + gaps[j - 1]);
	const shift = xs[anchorIdx];
	return xs.map((x) => x - shift);
}

// ---- Descendant blocks ----

interface Slot {
	order: number;
	unionId: string | null;
	/** Gap index a between-node moves with, or null for nodes that hang or slots with no node. */
	gapIdx: number | null;
	cardIdxs: number[];
	hasNode: boolean;
	subs: Sub[];
	offsets: number[];
	groupAnchor: number;
	contour: Contour;
	shift: number;
}

function stubSub(id: string, gen: number, m: LayoutMetrics): Sub {
	const contour: Contour = new Map();
	contourAdd(contour, gen, -m.stubWidth / 2, m.stubWidth / 2);
	return { items: [{ t: 'stub', id, gen, x: 0 }], contour };
}

function buildSlot(
	ctx: Context,
	order: number,
	unionId: string | null,
	gapIdx: number | null,
	cardIdxs: number[],
	hasNode: boolean,
	subs: Sub[]
): Slot {
	const offsets = sequenceOffsets(subs, ctx.m.siblingGap);
	const groupAnchor = subs.length > 0 ? (offsets[0] + offsets[offsets.length - 1]) / 2 : 0;
	const contour: Contour = new Map();
	subs.forEach((sub, i) => contourMerge(contour, sub.contour, offsets[i] - groupAnchor));
	return {
		order,
		unionId,
		gapIdx,
		cardIdxs,
		hasNode,
		subs,
		offsets,
		groupAnchor,
		contour,
		shift: 0
	};
}

/**
 * Whether the group made of `groupParentIds` may take `childId`. The anchor's own group always
 * can; any other waits for it, unless the anchor's group could never claim the child (an
 * ancestor card, another row, or a union that is not drawn), when first come keeps the old rule.
 */
function groupMayClaim(ctx: Context, childId: string, groupParentIds: string[]): boolean {
	const anchor = ctx.anchorOf.get(childId);
	if (anchor === undefined || groupParentIds.includes(anchor)) return true;
	if (ctx.ancestorIds.has(anchor)) return true;
	if (ctx.genOf.get(anchor) !== ctx.genOf.get(childId)! - 1) return true;
	const isHeldByAnchor = (ctx.index.parentLinksOfChild.get(childId) ?? []).some(
		(link) => link.parentId === anchor && (link.unionId === null || ctx.unionIds.has(link.unionId))
	);
	return !isHeldByAnchor;
}

/** Children of a parent that this block is allowed to place under itself. */
function claimChildren(
	ctx: Context,
	childIds: string[],
	row: number,
	edgeKey: (childId: string) => string,
	groupParentIds: string[]
) {
	const claimed: string[] = [];
	for (const childId of childIds) {
		if (!ctx.genOf.has(childId)) continue;
		// A child in two drawn groups hangs from the one holding its anchor parent, never from
		// whichever block happened to be laid out first; the other edge is secondary.
		if (ctx.placed.has(childId) || ctx.genOf.get(childId) !== row + 1) continue;
		if (!groupMayClaim(ctx, childId, groupParentIds)) continue;
		ctx.placed.add(childId);
		claimed.push(childId);
		ctx.primaryEdgeKeys.add(edgeKey(childId));
	}
	return claimed;
}

function layoutDescendantBlock(ctx: Context, anchorId: string, hint: 'left' | 'right'): Sub {
	const { m } = ctx;
	const row = ctx.genOf.get(anchorId)!;
	const { unions: drawnUnions, viaPartner } = chainUnions(ctx, anchorId);
	const chain = arrangeChain(ctx, anchorId, drawnUnions, hint, viaPartner);
	const anchorIdx = chain.cards.indexOf(anchorId);
	const placedUnions = classifyUnions(chain);

	// Claim every child group before recursing so no partner deeper down can take a sibling.
	const groups: Array<{
		unionId: string | null;
		gapIdx: number | null;
		cardIdxs: number[];
		hasNode: boolean;
		childIds: string[];
		stubId: string | null;
	}> = [];
	for (const pu of placedUnions) {
		const childIds = claimChildren(
			ctx,
			ctx.index.childIdsOfUnion.get(pu.id) ?? [],
			row,
			(c) => `${pu.id}|${c}`,
			unique(ctx.index.unionById.get(pu.id)?.partnerIds ?? [])
		);
		const stubId = `stub:children:${pu.id}`;
		groups.push({
			unionId: pu.id,
			gapIdx: pu.gapIdx,
			cardIdxs: pu.cardIdxs,
			hasNode: true,
			childIds,
			stubId: ctx.stubIds.has(stubId) ? stubId : null
		});
	}
	const directIds = claimChildren(
		ctx,
		ctx.index.directChildIdsOfParent.get(anchorId) ?? [],
		row,
		(c) => `direct|${anchorId}|${c}`,
		[anchorId]
	);
	const directStub = `stub:children:direct:${anchorId}`;
	if (directIds.length > 0 || ctx.stubIds.has(directStub)) {
		groups.push({
			unionId: null,
			gapIdx: null,
			cardIdxs: [anchorIdx],
			hasNode: false,
			childIds: directIds,
			stubId: ctx.stubIds.has(directStub) ? directStub : null
		});
	}
	chain.cards.forEach((cardId, idx) => {
		const otherStub = `stub:children:other:${cardId}`;
		if (ctx.stubIds.has(otherStub)) {
			groups.push({
				unionId: null,
				gapIdx: null,
				cardIdxs: [idx],
				hasNode: false,
				childIds: [],
				stubId: otherStub
			});
		}
	});

	const slots: Slot[] = groups.map((g, order) => {
		const subs = g.childIds.map((childId, i) =>
			layoutDescendantBlock(ctx, childId, g.childIds.length > 1 && i === 0 ? 'left' : 'right')
		);
		if (g.stubId) subs.push(stubSub(g.stubId, row + 1, m));
		return buildSlot(ctx, order, g.unionId, g.gapIdx, g.cardIdxs, g.hasNode, subs);
	});

	// Widen partner gaps (or nudge hanging nodes) until every group clears its neighbour.
	const gaps = new Array(Math.max(0, chain.cards.length - 1)).fill(m.partnerGap);
	const slotX = (slot: Slot, xs: number[]) => {
		const base =
			slot.gapIdx !== null
				? (xs[slot.gapIdx] + xs[slot.gapIdx + 1]) / 2
				: slot.cardIdxs.reduce((sum, i) => sum + xs[i], 0) / Math.max(1, slot.cardIdxs.length);
		return base + slot.shift;
	};
	const nodeClearance = 2 * m.unionRadius + 6;
	for (let pass = 0; pass < 60; pass++) {
		const xs = cardPositions(chain.cards.length, anchorIdx, gaps, m);
		const ordered = [...slots].sort((a, b) => slotX(a, xs) - slotX(b, xs) || a.order - b.order);
		let didChange = false;
		for (let i = 1; i < ordered.length && !didChange; i++) {
			const a = ordered[i - 1];
			const b = ordered[i];
			const hasA = a.subs.length > 0;
			const hasB = b.subs.length > 0;
			let need = 0;
			if (hasA && hasB) need = contourSeparation(a.contour, b.contour, m.siblingGap);
			else if (a.hasNode && b.hasNode && a.gapIdx === null && b.gapIdx === null)
				need = nodeClearance;
			const deficit = need - (slotX(b, xs) - slotX(a, xs));
			if (need > 0 && deficit > 1e-6) {
				if (b.gapIdx !== null) gaps[b.gapIdx] += 2 * deficit;
				else b.shift += deficit;
				didChange = true;
			}
		}
		if (!didChange) break;
	}

	const xs = cardPositions(chain.cards.length, anchorIdx, gaps, m);
	const items: Item[] = [];
	const contour: Contour = new Map();
	chain.cards.forEach((id, idx) => {
		items.push({ t: 'person', id, gen: row, x: xs[idx] });
		contourAdd(contour, row, xs[idx] - m.cardWidth / 2, xs[idx] + m.cardWidth / 2);
	});
	for (const slot of slots) {
		const x = slotX(slot, xs);
		if (slot.unionId && slot.hasNode) {
			items.push({ t: 'union', id: slot.unionId, gen: row, x, isHanging: slot.gapIdx === null });
			contourAdd(contour, row, x - m.unionRadius, x + m.unionRadius);
		}
		slot.subs.forEach((sub, i) => {
			const dx = x + slot.offsets[i] - slot.groupAnchor;
			items.push(...shiftItems(sub.items, dx));
			contourMerge(contour, sub.contour, dx);
		});
	}
	return { items, contour };
}

// ---- Ancestor blocks ----

/** Group parent unions into components that share a partner, so one person can sit between two unions. */
function unionComponents(unions: RelationshipGraphUnion[]): RelationshipGraphUnion[][] {
	const components: Array<{ people: Set<string>; unions: RelationshipGraphUnion[] }> = [];
	for (const union of unions) {
		const touching = components.filter((c) => union.partnerIds.some((id) => c.people.has(id)));
		const merged = { people: new Set(union.partnerIds), unions: [union] };
		for (const c of touching) {
			c.people.forEach((id) => merged.people.add(id));
			merged.unions.unshift(...c.unions);
			components.splice(components.indexOf(c), 1);
		}
		merged.unions.sort((a, b) => unions.indexOf(a) - unions.indexOf(b));
		components.push(merged);
	}
	return components.map((c) => c.unions);
}

/**
 * The parent blocks of `personId`, laid out with their own ancestors and referenced to the
 * centre of the parent blocks. Returns null when nothing sits above the person.
 */
function layoutParents(ctx: Context, personId: string): Sub | null {
	const { m } = ctx;
	const gen = ctx.genOf.get(personId)!;
	const row = gen - 1;

	const parentUnions = (ctx.index.parentUnionIdsOfChild.get(personId) ?? [])
		.filter((id) => ctx.unionIds.has(id) && !ctx.claimedParentUnions.has(id))
		.map((id) => ctx.index.unionById.get(id)!);
	for (const union of parentUnions) {
		ctx.claimedParentUnions.add(union.id);
		ctx.primaryEdgeKeys.add(`${union.id}|${personId}`);
	}
	const directParents = (ctx.index.directParentIdsOfChild.get(personId) ?? []).filter(
		(id) => ctx.genOf.get(id) === row && !ctx.placed.has(id)
	);
	for (const parentId of directParents) ctx.primaryEdgeKeys.add(`direct|${parentId}|${personId}`);

	const stubId = `stub:ancestors:${personId}`;
	if (parentUnions.length === 0 && directParents.length === 0) {
		return ctx.stubIds.has(stubId) ? stubSub(stubId, row, m) : null;
	}

	const blocks: Array<{ cards: string[]; chain: Chain }> = [];
	for (const component of unionComponents(parentUnions)) {
		const counts = new Map<string, number>();
		for (const u of component)
			for (const id of unique(u.partnerIds)) counts.set(id, (counts.get(id) ?? 0) + 1);
		const candidates = unique(component.flatMap((u) => u.partnerIds)).filter(
			(id) => !ctx.placed.has(id) && ctx.genOf.get(id) === row
		);
		if (candidates.length === 0) {
			for (const u of component) ctx.nonAdjacent.add(u.id);
			continue;
		}
		const anchor = candidates.reduce((best, id) =>
			(counts.get(id) ?? 0) > (counts.get(best) ?? 0) ? id : best
		);
		ctx.placed.add(anchor);
		const chain = arrangeChain(ctx, anchor, component, 'right');
		blocks.push({ cards: chain.cards, chain });
	}
	for (const parentId of directParents) {
		ctx.placed.add(parentId);
		blocks.push({ cards: [parentId], chain: { cards: [parentId], unions: [] } });
	}

	const blockSubs: Sub[] = [];
	const blockCentres: number[] = [];
	for (const block of blocks) {
		const cardSubs = block.cards.map((id) => {
			const above = layoutParents(ctx, id);
			const contour: Contour = new Map();
			contourAdd(contour, row, -m.cardWidth / 2, m.cardWidth / 2);
			if (above) contourMerge(contour, above.contour, 0);
			return { above, contour };
		});
		const offsets = sequenceOffsets(
			cardSubs.map((c) => ({ items: [], contour: c.contour })),
			m.siblingGap,
			m.cardWidth + m.partnerGap
		);
		const items: Item[] = [];
		const contour: Contour = new Map();
		block.cards.forEach((id, i) => {
			items.push({ t: 'person', id, gen: row, x: offsets[i] });
			contourMerge(contour, cardSubs[i].contour, offsets[i]);
			if (cardSubs[i].above) items.push(...shiftItems(cardSubs[i].above!.items, offsets[i]));
		});
		const unionNodes = classifyUnions(block.chain).map((pu) => ({
			pu,
			x:
				pu.gapIdx !== null
					? (offsets[pu.gapIdx] + offsets[pu.gapIdx + 1]) / 2
					: pu.cardIdxs.reduce((s, i) => s + offsets[i], 0) / Math.max(1, pu.cardIdxs.length)
		}));
		// Repeated unions between one pair all hang at the same midpoint; spread them so each
		// stays a distinct node with its own edges instead of stacking.
		const hanging = unionNodes.filter((n) => n.pu.gapIdx === null).sort((a, b) => a.x - b.x);
		for (let i = 1; i < hanging.length; i++) {
			hanging[i].x = Math.max(hanging[i].x, hanging[i - 1].x + 2 * m.unionRadius + 6);
		}
		for (const { pu, x } of unionNodes) {
			items.push({ t: 'union', id: pu.id, gen: row, x, isHanging: pu.gapIdx === null });
		}
		blockSubs.push({ items, contour });
		blockCentres.push((offsets[0] + offsets[offsets.length - 1]) / 2);
	}

	// Blocks are compared by their whole contours but referenced by their centres.
	const blockOffsets = sequenceOffsets(
		blockSubs.map((b, i) => ({
			items: b.items,
			contour: shiftedContour(b.contour, -blockCentres[i])
		})),
		m.siblingGap
	);
	const centre =
		blockSubs.length > 0 ? (blockOffsets[0] + blockOffsets[blockOffsets.length - 1]) / 2 : 0;
	const items: Item[] = [];
	const contour: Contour = new Map();
	blockSubs.forEach((b, i) => {
		const dx = blockOffsets[i] - blockCentres[i] - centre;
		items.push(...shiftItems(b.items, dx));
		contourMerge(contour, b.contour, dx);
	});
	return { items, contour };
}

function shiftedContour(contour: Contour, dx: number): Contour {
	const out: Contour = new Map();
	contourMerge(out, contour, dx);
	return out;
}

// ---- Entry point ----

export function placeHourglass(
	index: GraphIndex,
	selection: FocusSelection,
	m: LayoutMetrics = LAYOUT_METRICS
): Placement {
	const ctx: Context = {
		index,
		selection,
		m,
		genOf: new Map(selection.people.map((p) => [p.id, p.generation])),
		unionIds: new Set(selection.unions.map((u) => u.id)),
		stubIds: new Set(selection.stubs.map((s) => s.id)),
		placed: new Set(),
		claimedParentUnions: new Set(),
		primaryEdgeKeys: new Set(),
		nonAdjacent: new Set(),
		anchorOf: new Map(
			selection.people.flatMap((p) => (p.anchorParentId ? [[p.id, p.anchorParentId] as const] : []))
		),
		ancestorIds: new Set(
			selection.people.filter((p) => p.role === PERSON_ROLES.ANCESTOR).map((p) => p.id)
		)
	};

	// The focus row: children of the focus person's parent unions, so siblings stay contiguous.
	const focusId = selection.focusPersonId;
	const rowIds: string[] = [];
	for (const unionId of index.parentUnionIdsOfChild.get(focusId) ?? []) {
		if (!ctx.unionIds.has(unionId)) continue;
		for (const childId of index.childIdsOfUnion.get(unionId) ?? []) {
			const role = selection.people.find((p) => p.id === childId)?.role;
			if (
				!rowIds.includes(childId) &&
				(role === PERSON_ROLES.FOCUS || role === PERSON_ROLES.SIBLING)
			) {
				rowIds.push(childId);
			}
		}
	}
	if (!rowIds.includes(focusId)) rowIds.push(focusId);
	for (const id of rowIds) ctx.placed.add(id);

	const rowSubs = rowIds.map((id, i) =>
		layoutDescendantBlock(ctx, id, rowIds.length > 1 && i === 0 ? 'left' : 'right')
	);
	const rowOffsets = sequenceOffsets(rowSubs, m.siblingGap);
	const items: Item[] = [];
	rowSubs.forEach((sub, i) => items.push(...shiftItems(sub.items, rowOffsets[i])));

	// Ancestors hang from the middle of the focus row's children.
	const ancestors = layoutParents(ctx, focusId);
	for (const unionId of index.parentUnionIdsOfChild.get(focusId) ?? []) {
		if (!ctx.claimedParentUnions.has(unionId)) continue;
		for (const childId of rowIds) {
			if (index.childIdsOfUnion.get(unionId)?.includes(childId))
				ctx.primaryEdgeKeys.add(`${unionId}|${childId}`);
		}
	}
	if (ancestors)
		items.push(
			...shiftItems(ancestors.items, (rowOffsets[0] + rowOffsets[rowOffsets.length - 1]) / 2)
		);

	const focusX = items.find((it) => it.t === 'person' && it.id === focusId)!.x;
	return {
		items: shiftItems(items, -focusX),
		primaryEdgeKeys: ctx.primaryEdgeKeys,
		nonAdjacentUnionIds: [...ctx.nonAdjacent]
	};
}
