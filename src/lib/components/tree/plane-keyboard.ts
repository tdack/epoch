/**
 * Where an arrow key goes in the 3D views, where a card's row is one band (a plane in `layers`, a
 * row of a floor in `floors`) of one generation. Pure like `neighbourOf`, which it mirrors for the
 * flat view, so the same keys mean the same things in all three (ADR-030).
 */

import { NAV_DIRECTIONS, type NavDirection } from './tree-view.js';
import type { BandDirection } from './tree-keyboard.js';

interface PlaneNavPerson {
	id: string;
	/** The band or plane the card stands on; 0 is the direct line. */
	group: number;
	generation: number;
	x: number;
}

/** One child and the parents a line to it leaves from. */
interface PlaneNavLink {
	childId: string;
	parentIds: string[];
	isSecondaryPath: boolean;
}

export interface PlaneNav {
	people: PlaneNavPerson[];
	links: PlaneNavLink[];
	/** The partners of each drawn union, so left and right prefer a partner. */
	unionPartners: string[][];
}

interface ChildLine {
	childId: string;
	unionId: string | null;
	assertions: { parentId: string }[];
	isSecondaryPath: boolean;
}

/** Child lines in either view's own shape, with the parents each one stands for. */
export function childLinks(
	lines: readonly ChildLine[],
	partnersOfUnion: ReadonlyMap<string, string[]>
): PlaneNavLink[] {
	return lines.map((line) => ({
		childId: line.childId,
		isSecondaryPath: line.isSecondaryPath,
		parentIds: line.unionId
			? (partnersOfUnion.get(line.unionId) ?? [])
			: line.assertions.map((a) => a.parentId)
	}));
}

function nearestTo(candidates: PlaneNavPerson[], from: PlaneNavPerson): PlaneNavPerson | null {
	let best: PlaneNavPerson | null = null;
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
 * The person a key moves to, or null when nothing lies that way. Up goes to a parent and Down to
 * the leftmost child, on whatever plane or floor they stand. Left and Right stay in the row,
 * preferring a partner or sibling and falling back to whoever is next. Alt+Up and Alt+Down move to
 * the nearest row of the next band that holds anyone, on the nearest generation, then the nearest x.
 */
export function planeNeighbour(
	nav: PlaneNav,
	fromId: string,
	move: NavDirection | BandDirection
): string | null {
	const people = new Map(nav.people.map((p) => [p.id, p]));
	const from = people.get(fromId);
	if (!from) return null;

	if (move === 'back' || move === 'front') {
		const step = move === 'back' ? 1 : -1;
		const groups = [...new Set(nav.people.map((p) => p.group))]
			.filter((g) => (g - from.group) * step > 0)
			.sort((a, b) => (a - b) * step);
		const next = groups[0];
		if (next === undefined) return null;
		const inGroup = nav.people.filter((p) => p.group === next);
		const gap = Math.min(...inGroup.map((p) => Math.abs(p.generation - from.generation)));
		return (
			nearestTo(
				inGroup.filter((p) => Math.abs(p.generation - from.generation) === gap),
				from
			)?.id ?? null
		);
	}

	if (move === NAV_DIRECTIONS.UP) {
		const parents = nav.links
			.filter((l) => l.childId === fromId && !l.isSecondaryPath)
			.flatMap((l) => l.parentIds)
			.map((id) => people.get(id))
			.filter((p): p is PlaneNavPerson => !!p && p.id !== fromId && p.generation < from.generation);
		return nearestTo(parents, from)?.id ?? null;
	}

	if (move === NAV_DIRECTIONS.DOWN) {
		const children = nav.links
			.filter((l) => l.parentIds.includes(fromId))
			.map((l) => people.get(l.childId))
			.filter((p): p is PlaneNavPerson => !!p && p.generation > from.generation);
		children.sort((a, b) => a.x - b.x || a.id.localeCompare(b.id));
		return children[0]?.id ?? null;
	}

	const related = new Set<string>();
	for (const partners of nav.unionPartners) {
		if (partners.includes(fromId)) for (const id of partners) related.add(id);
	}
	for (const mine of nav.links.filter((l) => l.childId === fromId && !l.isSecondaryPath)) {
		for (const other of nav.links) {
			if (other.parentIds.join('|') === mine.parentIds.join('|')) related.add(other.childId);
		}
	}
	related.delete(fromId);

	const sign = move === NAV_DIRECTIONS.LEFT ? -1 : 1;
	const sameRow = nav.people.filter(
		(p) =>
			p.group === from.group &&
			p.generation === from.generation &&
			p.id !== fromId &&
			Math.sign(p.x - from.x) === sign
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
