/**
 * View-side helpers for the tree canvas: level of detail, edge geometry, card text, keyboard
 * navigation and accessible names. Pure so they can be tested without a DOM; card and row sizes
 * come from the layout module so the two can never drift apart.
 */

import type { UnionStatus } from '#lib/shared/relationship-model.js';
import { END_EVENT_TYPES, UNION_EVENT_ABBREVIATIONS } from '#lib/shared/union-events.js';
import { splitDisplayName } from '#lib/shared/name-types.js';
import {
	LAYOUT_METRICS,
	type ChildEdge,
	type ParentChildType,
	type PartnerEdge,
	type PlacedPerson,
	type PlacedStub,
	type RelationshipGraphUnion,
	type Point,
	type StubEdge,
	type TreeLayout
} from '#lib/tree-layout/index.js';

const M = LAYOUT_METRICS;

export const MIN_ZOOM = 0.15;
export const MAX_ZOOM = 3;
/** Fit never enlarges past this, so a two-person tree is not blown up to fill the pane. */
export const MAX_FIT_ZOOM = 1;

const LEVELS_OF_DETAIL = { FULL: 'full', COMPACT: 'compact', BLOCK: 'block' } as const;
export type LevelOfDetail = (typeof LEVELS_OF_DETAIL)[keyof typeof LEVELS_OF_DETAIL];

/** Zoom scale at which a card drops from full to name-and-years (exclusive), and to a block. */
export const FULL_ABOVE_ZOOM = 0.6;
export const COMPACT_FROM_ZOOM = 0.3;

export function levelOfDetail(zoom: number): LevelOfDetail {
	if (zoom > FULL_ABOVE_ZOOM) return LEVELS_OF_DETAIL.FULL;
	if (zoom >= COMPACT_FROM_ZOOM) return LEVELS_OF_DETAIL.COMPACT;
	return LEVELS_OF_DETAIL.BLOCK;
}

/** Smallest on-screen size a click target keeps, whatever the zoom. */
export const MIN_HIT_TARGET_PX = 24;

/**
 * Hit rectangle for a card at the given zoom: at least the card, at least the minimum touch size
 * on screen, but never wider than the gap to the neighbouring card allows.
 */
export function hitSize(zoom: number): { width: number; height: number } {
	const wanted = MIN_HIT_TARGET_PX / Math.max(zoom, MIN_ZOOM);
	return {
		width: Math.min(M.cardWidth + M.siblingGap - 4, Math.max(M.cardWidth, wanted)),
		height: Math.min(M.rowHeight - 20, Math.max(M.cardHeight, wanted))
	};
}

// ---- Menus ----

export interface MenuItem {
	label: string;
	isDanger?: boolean;
	onClick: () => void;
}

// ---- Card text ----

function yearOf(text: string | null | undefined): string | null {
	return text?.match(/\b(\d{3,4})\b/)?.[1] ?? null;
}

/**
 * The text under a union node: how the partnership began, then how it ended, e.g. "1975 – div. 1999".
 * Falls back to the marriage columns for graphs that carry no event list.
 */
export function unionLabelText(union: RelationshipGraphUnion): string {
	const events = union.events ?? [];
	const start = events.find((e) => e.type === 'ENGA' || e.type === '_PSTART');
	const begin =
		union.marriageDate ||
		union.marriagePlace ||
		(start
			? [UNION_EVENT_ABBREVIATIONS[start.type], start.dateText].filter(Boolean).join(' ')
			: '');
	const end = END_EVENT_TYPES.map((type) => events.find((e) => e.type === type)).find(
		(e) => e?.dateText
	);
	const ending = end ? `${UNION_EVENT_ABBREVIATIONS[end.type]} ${end.dateText}` : '';
	return [begin, ending].filter(Boolean).join(' – ');
}

// U+FE0E asks for the plain glyph: without it ⚧ renders as a colour emoji beside the monochrome ♂ and ♀.
export const SEX_SYMBOLS = { M: '♂', F: '♀', X: '⚧\uFE0E', neutral: '○' } as const;

export function sexSymbol(sex: PlacedPerson['person']['sex']): string {
	if (sex === 'M') return SEX_SYMBOLS.M;
	if (sex === 'F') return SEX_SYMBOLS.F;
	return sex === 'X' ? SEX_SYMBOLS.X : SEX_SYMBOLS.neutral;
}

export function sexClass(sex: PlacedPerson['person']['sex']): 'm' | 'f' | 'u' {
	return sex === 'M' ? 'm' : sex === 'F' ? 'f' : 'u';
}

export const DEATH_MARK = '†';

/** "1950 – 2010", "b. 1950", "† 2010", "†" (died, date unknown) or "". */
export function yearsLine(person: PlacedPerson['person']): string {
	const birth = yearOf(person.birthDate);
	const death = yearOf(person.deathDate);
	if (birth && death) return `${birth} – ${DEATH_MARK} ${death}`;
	if (birth) return person.isDeceased ? `${birth} – ${DEATH_MARK}` : `b. ${birth}`;
	if (death) return `${DEATH_MARK} ${death}`;
	return person.isDeceased ? DEATH_MARK : '';
}

/** Full-card date lines: the original text, so `ABT 1900` is not shown as an exact year. */
export function dateLines(person: PlacedPerson['person']): string[] {
	const lines: string[] = [];
	if (person.birthDate) lines.push(`b. ${person.birthDate}`);
	if (person.deathDate) lines.push(`${DEATH_MARK} ${person.deathDate}`);
	else if (person.isDeceased) lines.push(DEATH_MARK);
	return lines;
}

export function truncate(text: string, maxChars: number): string {
	return text.length <= maxChars ? text : `${text.slice(0, Math.max(1, maxChars - 1)).trimEnd()}…`;
}

/** First letter of the last word of the name, for the block shown below the compact zoom. */
export function surnameInitial(displayName: string): string {
	const words = splitDisplayName(displayName).name.trim().split(/\s+/);
	return (words.at(-1) ?? '?').charAt(0).toUpperCase() || '?';
}

// ---- Accessible names ----

function generationWord(generations: number, base: string): string {
	if (generations <= 1) return base;
	if (generations === 2) return `grand${base}`;
	return generations === 3 ? `great-grand${base}` : `${generations - 2}× great-grand${base}`;
}

/** Wording for an ancestor or descendant `generations` away, with no gendered terms. */
export function generationLabel(direction: 'ancestor' | 'descendant', generations: number): string {
	return generationWord(generations, direction === 'ancestor' ? 'parent' : 'child');
}

/**
 * How a drawn person relates to the focus person, in neutral wording. A person's role alone is
 * not enough: a "partner" may be the partner of a child, and a child of a partner is a
 * step-child, so the label checks who is actually linked to the focus in the drawn edges.
 */
export function relationLabel(person: PlacedPerson, layout: TreeLayout): string {
	const focusId = layout.focusPersonId;
	const nameOf = (id: string) => layout.people.find((p) => p.id === id)?.person.displayName ?? id;
	const childEdges = layout.edges.filter((e): e is ChildEdge => e.kind === 'child');
	switch (person.role) {
		case 'focus':
			return 'focus person';
		case 'sibling':
			return 'sibling';
		case 'partner': {
			const sharing = layout.unions.filter((u) => u.union.partnerIds.includes(person.id));
			if (sharing.some((u) => focusId && u.union.partnerIds.includes(focusId))) return 'partner';
			const other = sharing.flatMap((u) => u.union.partnerIds).find((id) => id !== person.id);
			return other ? `partner of ${nameOf(other)}` : 'partner';
		}
		case 'ancestor': {
			if (person.generation !== -1) return generationLabel('ancestor', -person.generation);
			const isParent = childEdges.some(
				(e) => e.childId === focusId && e.assertions.some((a) => a.parentId === person.id)
			);
			return isParent ? 'parent' : 'step-parent';
		}
		case 'descendant': {
			if (person.generation !== 1) return generationLabel('descendant', person.generation);
			const isChild = childEdges.some(
				(e) => e.childId === person.id && e.assertions.some((a) => a.parentId === focusId)
			);
			return isChild ? 'child' : 'step-child';
		}
	}
}

/** The card's screen-reader name: person, dates, then the relationship to the focus person. */
export function accessibleName(person: PlacedPerson, relation: string): string {
	const parts = [person.person.displayName];
	if (person.person.birthDate) parts.push(`born ${person.person.birthDate}`);
	if (person.person.deathDate) parts.push(`died ${person.person.deathDate}`);
	else if (person.person.isDeceased) parts.push('deceased');
	parts.push(relation);
	return parts.join(', ');
}

// ---- Relationship styling ----

export interface LineStyle {
	label: string;
	colorVar: string;
	/** SVG dash array in screen pixels (strokes are non-scaling); null is solid. */
	dash: string | null;
	isRound: boolean;
}

export const RELATIONSHIP_STYLES: Record<ParentChildType, LineStyle> = {
	biological: { label: 'Biological', colorVar: '--rel-biological', dash: null, isRound: false },
	adoptive: { label: 'Adoptive', colorVar: '--rel-adoptive', dash: '12 6', isRound: false },
	foster: { label: 'Foster', colorVar: '--rel-foster', dash: '5 4', isRound: false },
	guardian: { label: 'Guardian', colorVar: '--rel-guardian', dash: '1 5', isRound: true },
	unknown: { label: 'Unknown', colorVar: '--rel-unknown', dash: '1 8', isRound: true }
};

export const MIXED_STYLE: LineStyle = {
	label: 'Mixed types',
	colorVar: '--rel-mixed',
	dash: '14 4 2 4',
	isRound: false
};

/** One type keeps its own style; several parents with different types read as mixed. */
export function childEdgeStyle(types: readonly ParentChildType[]): LineStyle {
	return types.length === 1 ? RELATIONSHIP_STYLES[types[0]] : MIXED_STYLE;
}

/**
 * Separated, divorced, annulled or ended. Mirrors `isEndedUnionStatus` on the server, which the
 * browser bundle may not import.
 */
export function isEndedUnion(status: UnionStatus): boolean {
	return status !== 'active';
}

// ---- Edge geometry ----

const CORNER_RADIUS = 8;

/** Curve from just below the parent (union node or card) to the top of the child card. */
export function childEdgePath(edge: ChildEdge): string {
	const start: Point = {
		x: edge.source.x,
		y: edge.source.y + (edge.unionId ? M.unionRadius : M.cardHeight / 2)
	};
	const end: Point = { x: edge.target.x, y: edge.target.y - M.cardHeight / 2 };
	const midY = (start.y + end.y) / 2;
	return `M ${start.x} ${start.y} C ${start.x} ${midY}, ${end.x} ${midY}, ${end.x} ${end.y}`;
}

/**
 * Partner to union connector. A union between two adjacent cards is a straight line along the
 * row. A union hanging below the row gets a bracket under the cards, so a partner that is not
 * next to the node still reads as joined to it instead of a line running behind other cards.
 */
export function partnerEdgePath(edge: PartnerEdge): string {
	const { source: person, target: node } = edge;
	if (Math.abs(node.y - person.y) < 1) {
		const direction = Math.sign(node.x - person.x) || 1;
		return `M ${person.x + (direction * M.cardWidth) / 2} ${person.y} L ${node.x - direction * M.unionRadius} ${node.y}`;
	}
	const top = person.y + M.cardHeight / 2;
	const dx = node.x - person.x;
	if (Math.abs(dx) < 1) return `M ${person.x} ${top} L ${node.x} ${node.y - M.unionRadius}`;
	const direction = Math.sign(dx);
	const r = Math.min(CORNER_RADIUS, node.y - top, Math.abs(dx) / 2);
	return [
		`M ${person.x} ${top}`,
		`L ${person.x} ${node.y - r}`,
		`Q ${person.x} ${node.y} ${person.x + direction * r} ${node.y}`,
		`L ${node.x - direction * M.unionRadius} ${node.y}`
	].join(' ');
}

export function stubEdgePath(edge: StubEdge, stub: PlacedStub, isFromUnion: boolean): string {
	if (stub.kind === 'ancestors') {
		// The edge stores the stub as source and the person it hangs above as target.
		const from = { x: edge.source.x, y: edge.source.y + M.stubHeight / 2 };
		const to = { x: edge.target.x, y: edge.target.y - M.cardHeight / 2 };
		const midY = (from.y + to.y) / 2;
		return `M ${from.x} ${from.y} C ${from.x} ${midY}, ${to.x} ${midY}, ${to.x} ${to.y}`;
	}
	const from = {
		x: edge.source.x,
		y: edge.source.y + (isFromUnion ? M.unionRadius : M.cardHeight / 2)
	};
	const to = { x: edge.target.x, y: edge.target.y - M.stubHeight / 2 };
	const midY = (from.y + to.y) / 2;
	return `M ${from.x} ${from.y} C ${from.x} ${midY}, ${to.x} ${midY}, ${to.x} ${to.y}`;
}

// ---- Keyboard navigation ----

export const NAV_DIRECTIONS = { UP: 'up', DOWN: 'down', LEFT: 'left', RIGHT: 'right' } as const;
export type NavDirection = (typeof NAV_DIRECTIONS)[keyof typeof NAV_DIRECTIONS];

function nearestTo(candidates: PlacedPerson[], from: PlacedPerson): PlacedPerson | null {
	let best: PlacedPerson | null = null;
	for (const c of candidates) {
		if (!best) best = c;
		else {
			const a = Math.abs(c.x - from.x);
			const b = Math.abs(best.x - from.x);
			if (a < b || (a === b && c.id < best.id)) best = c;
		}
	}
	return best;
}

/**
 * The person an arrow key moves to: up to a parent, down to a child (the leftmost), and
 * left/right to the nearest partner or sibling in that direction, falling back to whoever is
 * next on the row. Returns null when nothing lies that way.
 */
export function neighbourOf(
	layout: TreeLayout,
	fromId: string,
	direction: NavDirection
): string | null {
	const people = new Map(layout.people.map((p) => [p.id, p]));
	const from = people.get(fromId);
	if (!from) return null;
	const unions = new Map(layout.unions.map((u) => [u.id, u]));
	const childEdges = layout.edges.filter((e): e is ChildEdge => e.kind === 'child');
	const partnersOfUnion = (unionId: string) =>
		(unions.get(unionId)?.union.partnerIds ?? [])
			.map((id) => people.get(id))
			.filter((p): p is PlacedPerson => !!p);

	if (direction === NAV_DIRECTIONS.UP) {
		const parents: PlacedPerson[] = [];
		for (const e of childEdges.filter((e) => e.childId === fromId && !e.isSecondaryPath)) {
			if (e.unionId) parents.push(...partnersOfUnion(e.unionId));
			else
				for (const a of e.assertions)
					if (people.has(a.parentId)) parents.push(people.get(a.parentId)!);
		}
		const above = parents.filter((p) => p.id !== fromId && p.y < from.y);
		return nearestTo(above, from)?.id ?? null;
	}

	if (direction === NAV_DIRECTIONS.DOWN) {
		const children: PlacedPerson[] = [];
		for (const e of childEdges) {
			const isParent = e.unionId
				? (unions.get(e.unionId)?.union.partnerIds ?? []).includes(fromId)
				: e.assertions.some((a) => a.parentId === fromId);
			const child = people.get(e.childId);
			if (isParent && child && child.y > from.y) children.push(child);
		}
		children.sort((a, b) => a.x - b.x || a.id.localeCompare(b.id));
		return children[0]?.id ?? null;
	}

	const related = new Set<string>();
	for (const u of layout.unions) {
		if (u.union.partnerIds.includes(fromId)) for (const id of u.union.partnerIds) related.add(id);
	}
	for (const mine of childEdges.filter((e) => e.childId === fromId && !e.isSecondaryPath)) {
		for (const other of childEdges) {
			if (
				other.unionId === mine.unionId &&
				(mine.unionId || other.assertions[0]?.parentId === mine.assertions[0]?.parentId)
			) {
				related.add(other.childId);
			}
		}
	}
	related.delete(fromId);

	const sign = direction === NAV_DIRECTIONS.LEFT ? -1 : 1;
	const sameRow = layout.people.filter(
		(p) => p.y === from.y && p.id !== fromId && Math.sign(p.x - from.x) === sign
	);
	return (
		(
			nearestTo(
				sameRow.filter((p) => related.has(p.id)),
				from
			) ?? nearestTo(sameRow, from)
		)?.id ?? null
	);
}

// ---- Contrast ----

function channel(value: number): number {
	const c = value / 255;
	return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function contrastRatio(foreground: string, background: string): number {
	const luminance = (hex: string) => {
		const n = Number.parseInt(hex.replace('#', ''), 16);
		return (
			0.2126 * channel((n >> 16) & 255) +
			0.7152 * channel((n >> 8) & 255) +
			0.0722 * channel(n & 255)
		);
	};
	const [a, b] = [luminance(foreground), luminance(background)].sort((x, y) => y - x);
	return (a + 0.05) / (b + 0.05);
}
