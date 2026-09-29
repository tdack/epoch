import type { FocusViewOptions } from './types.js';

/** Depth/sibling combinations whose crossing counts are recorded in the baseline file. */
export const CROSSING_CONFIGS: FocusViewOptions[] = [
	{ ancestorDepth: 1, descendantDepth: 1, includeSiblings: true },
	{ ancestorDepth: 2, descendantDepth: 2, includeSiblings: true },
	{ ancestorDepth: 3, descendantDepth: 3, includeSiblings: false },
	{ ancestorDepth: 8, descendantDepth: 8, includeSiblings: true }
];

export function crossingKey(graphName: string, personIndex: number, config: FocusViewOptions): string {
	return `${graphName}|${personIndex}|${config.ancestorDepth}-${config.descendantDepth}-${config.includeSiblings ? 's' : 'n'}`;
}
