/**
 * Which names on the rings overview may show without covering another (ADR-032). On a real tree
 * the focus line alone is dozens of people stacked a few pixels apart, and overlapping names read
 * as neither. Names are placed in priority order and one that would cover a placed name stays
 * hidden; it shows again when the camera turns it clear, or when it takes keyboard focus.
 */

import type { RingRole } from './rings-scene.js';

export interface LabelBox {
	id: string;
	/** Left and top edges and size, in CSS pixels. */
	left: number;
	top: number;
	width: number;
	height: number;
}

/** Space kept clear round each name, in CSS pixels. */
const LABEL_GAP_PX = 2;

/**
 * Lower is placed first: the person under the pointer and the open drawer, then the focus, then
 * the focus line from the nearest generation outwards, then everyone else the same way.
 */
export function labelRank(
	role: RingRole,
	generation: number,
	special: { isHovered: boolean; isSelected: boolean }
): number {
	if (special.isHovered) return 0;
	if (special.isSelected) return 1;
	if (role === 'focus') return 2;
	return (role === null ? 1000 : 10) + Math.abs(generation) * 10 + (role === 'partner' ? 5 : 0);
}

/**
 * @param boxes in priority order (see {@link labelRank}).
 * @returns the ids that show; every other box would cover one that does.
 */
export function clearLabels(boxes: LabelBox[]): Set<string> {
	const placed: LabelBox[] = [];
	const shown = new Set<string>();
	for (const box of boxes) {
		const isCovering = placed.some(
			(other) =>
				box.left < other.left + other.width + LABEL_GAP_PX &&
				other.left < box.left + box.width + LABEL_GAP_PX &&
				box.top < other.top + other.height + LABEL_GAP_PX &&
				other.top < box.top + box.height + LABEL_GAP_PX
		);
		if (isCovering) continue;
		placed.push(box);
		shown.add(box.id);
	}
	return shown;
}
