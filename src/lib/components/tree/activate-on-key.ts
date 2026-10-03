/**
 * Enter and Space activate a control that is not a native button (an SVG group with
 * `role="button"`). One definition of "the activation keys", for the elements that do the same
 * thing on click and on key, and for the one that adds a Shift variant.
 */

export function isActivationKey(event: KeyboardEvent): boolean {
	return event.key === 'Enter' || event.key === ' ';
}

/**
 * A `keydown` handler that runs `onActivate` for Enter or Space instead of scrolling, and ignores
 * every other key. A function rather than a Svelte action so the markup still shows a key handler
 * beside its click handler, which is what the accessibility check looks for.
 */
export function activateOnKey(
	onActivate: (event: KeyboardEvent) => void
): (event: KeyboardEvent) => void {
	return (event) => {
		if (!isActivationKey(event)) return;
		event.preventDefault();
		onActivate(event);
	};
}
