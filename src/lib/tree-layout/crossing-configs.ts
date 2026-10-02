import type { FocusViewOptions } from './types.js';

/** Depth/sibling combinations whose crossing counts are recorded in the baseline file. */
export const CROSSING_CONFIGS: FocusViewOptions[] = [
	{ ancestorDepth: 1, descendantDepth: 1, shouldIncludeSiblings: true },
	{ ancestorDepth: 2, descendantDepth: 2, shouldIncludeSiblings: true },
	{ ancestorDepth: 3, descendantDepth: 3, shouldIncludeSiblings: false },
	{ ancestorDepth: 8, descendantDepth: 8, shouldIncludeSiblings: true }
];

export function crossingKey(
	graphName: string,
	personIndex: number,
	config: FocusViewOptions
): string {
	return `${graphName}|${personIndex}|${config.ancestorDepth}-${config.descendantDepth}-${config.shouldIncludeSiblings ? 's' : 'n'}`;
}
