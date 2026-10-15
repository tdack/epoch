/**
 * Whether to hold animation still: the system's prefers-reduced-motion, or the viewer's own
 * "Reduce animation" setting (ADR-054). The root layout marks the page with
 * {@link REDUCE_MOTION_ATTRIBUTE} when the setting is on, so code with no route data to read, such
 * as the flat view's viewport, can still honour it. The setting only adds reduction.
 */

/** Set on the root layout's wrapper when the viewer chose to reduce animation. */
export const REDUCE_MOTION_ATTRIBUTE = 'data-reduce-motion';

export function shouldReduceMotion(): boolean {
	const isOsReducing =
		typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
	const isUserReducing =
		typeof document !== 'undefined' &&
		document.querySelector(`[${REDUCE_MOTION_ATTRIBUTE}]`) !== null;
	return isOsReducing || isUserReducing;
}
