/**
 * Travelling through the layers view by generation. Zooming in past the limit dives through the
 * front plane into one of the families behind it, which becomes the new front; zooming out past the
 * fit surfaces back to where the dive started. Pure, so the choice of family, the trail and the
 * wheel intent are tested without a browser.
 */

import type { Band } from '#lib/tree-layout/index.js';
import type { LayersLayout } from '#lib/tree-layout/layers.js';

/** Where a dive lands: the person and partnership the chart is re-centred on. */
export interface DiveTarget {
	focusId: string;
	unionId: string | null;
	/** The family as a reader names it: the partners, joined. */
	label: string;
	/** The person on the front plane whose parents these are. */
	childId: string;
	/** Where the family stands, so a pointer can pick the nearest one. */
	at: { plane: Band; generation: number; x: number };
}

/** A family the viewer dived out of, to surface back to. */
export interface TrailEntry {
	focusId: string;
	unionId: string | null;
	label: string;
}

export function familyLabel(names: readonly string[]): string {
	return names.filter((name) => name.trim() !== '').join(' & ') || 'Unnamed family';
}

/**
 * The families one generation back from the focus partnership: each partner's parents, in
 * `union_partner` order, so the first partner's family is listed (and drawn) first. A partner whose
 * parents are not drawn adds nothing, so an empty list means there is nowhere to dive.
 */
export function parentFamilies(layout: LayersLayout): DiveTarget[] {
	const focusId = layout.focusPersonId;
	if (!focusId) return [];
	const peopleById = new Map(layout.people.map((p) => [p.id, p]));
	const nameOf = (id: string) => peopleById.get(id)?.person.displayName ?? '';
	const focusUnion = layout.unions.find((u) => u.id === layout.focusUnionId);
	const fromIds = focusUnion
		? focusUnion.union.partnerIds.filter((id) => peopleById.has(id))
		: [focusId];

	const targets: DiveTarget[] = [];
	const seen = new Set<string>();
	for (const childId of fromIds) {
		const union = layout.unions.find((u) => u.union.children.some((c) => c.childId === childId));
		const partners = union?.union.partnerIds.filter((id) => peopleById.has(id)) ?? [];
		if (union && partners.length > 0) {
			if (seen.has(union.id)) continue;
			seen.add(union.id);
			targets.push({
				focusId: partners[0],
				unionId: union.id,
				label: familyLabel(partners.map(nameOf)),
				childId,
				at: { plane: union.plane, generation: union.generation, x: union.x }
			});
			continue;
		}
		// Parents asserted without a partnership between them: dive to the first one drawn.
		const edge = layout.edges.find(
			(e) => e.kind === 'child' && e.childId === childId && !e.isSecondaryPath
		);
		const parentId =
			edge?.kind === 'child'
				? edge.assertions.map((a) => a.parentId).find((id) => peopleById.has(id))
				: undefined;
		const parent = parentId ? peopleById.get(parentId) : undefined;
		if (!parent || seen.has(parent.id)) continue;
		seen.add(parent.id);
		targets.push({
			focusId: parent.id,
			unionId: null,
			label: familyLabel([parent.person.displayName]),
			childId,
			at: { plane: parent.plane, generation: parent.generation, x: parent.x }
		});
	}
	return targets;
}

/** The family the chart is centred on now, named as the trail shows it. */
export function currentFamily(layout: LayersLayout): TrailEntry | null {
	const focusId = layout.focusPersonId;
	if (!focusId) return null;
	const names = new Map(layout.people.map((p) => [p.id, p.person.displayName]));
	const union = layout.unions.find((u) => u.id === layout.focusUnionId);
	const ids = union ? union.union.partnerIds.filter((id) => names.has(id)) : [focusId];
	return {
		focusId,
		unionId: layout.focusUnionId,
		label: familyLabel(ids.map((id) => names.get(id) ?? ''))
	};
}

/**
 * The trail after the chart was re-centred on `focusId`. Arriving where a dive was heading pushes the
 * family it left; arriving at a family already on the trail (surfacing, or the browser's Back)
 * drops it and everything after it; arriving anywhere else was a jump, so the trail starts again.
 */
export function reconcileTrail(
	trail: readonly TrailEntry[],
	focusId: string | null,
	pending: { target: DiveTarget; from: TrailEntry } | null
): TrailEntry[] {
	if (!focusId) return [];
	if (pending && pending.target.focusId === focusId) return [...trail, pending.from];
	const index = trail.findLastIndex((entry) => entry.focusId === focusId);
	return index >= 0 ? trail.slice(0, index) : [];
}

export const DIVE_DIRECTIONS = { IN: 'in', OUT: 'out' } as const;
export type DiveDirection = (typeof DIVE_DIRECTIONS)[keyof typeof DIVE_DIRECTIONS];

/**
 * The zoom one wheel event asks for, in powers of two (positive zooms in): d3-zoom's own formula, so
 * pushing past the limit feels like the zoom it continues.
 */
export function wheelZoomLog2(event: Pick<WheelEvent, 'deltaY' | 'deltaMode' | 'ctrlKey'>): number {
	const perUnit = event.deltaMode === 1 ? 0.05 : event.deltaMode ? 1 : 0.002;
	return -event.deltaY * perUnit * (event.ctrlKey ? 10 : 1);
}

interface DiveIntentOptions {
	/** Zoom, in powers of two, that has to be asked for past the limit to travel. */
	thresholdLog2?: number;
	/** A pause this long at the limit separates momentum from a deliberate second push. */
	quietMs?: number;
	/** How long the gathered push takes to drain once the wheel stops. */
	decayMs?: number;
	/** How long the push holds before it starts to drain. */
	holdMs?: number;
}

/**
 * How hard the viewer is pushing past the end of the zoom. A trackpad keeps sending wheel events
 * after the fingers lift, so the burst that reaches the limit never counts: only a push that starts
 * after a pause does. The push drains when the wheel stops, so a half-hearted push springs back.
 */
export class DiveIntent {
	private readonly thresholdLog2: number;
	private readonly quietMs: number;
	private readonly decayMs: number;
	private readonly holdMs: number;
	private gathered = 0;
	private gatheredAt = 0;
	private lastEventAt = Number.NEGATIVE_INFINITY;
	private isArmed = false;
	direction: DiveDirection | null = null;

	constructor(options: DiveIntentOptions = {}) {
		this.thresholdLog2 = options.thresholdLog2 ?? 1;
		this.quietMs = options.quietMs ?? 150;
		this.decayMs = options.decayMs ?? 420;
		this.holdMs = options.holdMs ?? 240;
	}

	/** Share of the threshold gathered at `now`, after any drain; 0 to 1. */
	progressAt(now: number): number {
		const drained = Math.max(0, now - this.gatheredAt - this.holdMs) / this.decayMs;
		return Math.min(1, Math.max(0, this.gathered / this.thresholdLog2 - drained));
	}

	/**
	 * Feed one wheel event. `isAtLimit` says whether the zoom already stands at the end this event
	 * pushes toward. Returns the direction to travel once the push is complete, else null.
	 */
	push(now: number, zoomLog2: number, isAtLimit: boolean): DiveDirection | null {
		const quiet = now - this.lastEventAt;
		this.lastEventAt = now;
		const direction = zoomLog2 > 0 ? DIVE_DIRECTIONS.IN : DIVE_DIRECTIONS.OUT;
		if (!isAtLimit) {
			// Zooming the other way while a push is gathered takes it back, rather than resetting it.
			if (this.direction && this.direction !== direction && this.progressAt(now) > 0) {
				this.settle(now, this.progressAt(now) * this.thresholdLog2 - Math.abs(zoomLog2));
				return null;
			}
			this.reset();
			return null;
		}
		if (this.direction !== direction) {
			this.reset();
			this.direction = direction;
		}
		if (!this.isArmed) {
			if (quiet < this.quietMs) return null;
			this.isArmed = true;
		}
		this.settle(now, this.progressAt(now) * this.thresholdLog2 + Math.abs(zoomLog2));
		if (this.gathered < this.thresholdLog2) return null;
		this.reset();
		return direction;
	}

	reset() {
		this.gathered = 0;
		this.isArmed = false;
		this.direction = null;
	}

	private settle(now: number, gathered: number) {
		this.gathered = Math.max(0, gathered);
		this.gatheredAt = now;
	}
}
