/** How far, in CSS pixels after damping, a pull must travel before letting go refreshes. */
export const PULL_THRESHOLD_PX = 70;
/** Finger travel is halved so the indicator lags the finger, as native pull-to-refresh does. */
const PULL_DAMPING = 0.5;
const MAX_PULL_PX = PULL_THRESHOLD_PX * 1.5;

/** A home-screen app has no reload button or browser pull-to-refresh, so only there is one added. */
export function isInstalledApp(): boolean {
	return (
		window.matchMedia?.('(display-mode: standalone)').matches ||
		// Safari's own flag, which predates display-mode and is missing from the DOM types.
		Reflect.get(navigator, 'standalone') === true
	);
}

/**
 * Whether a pull starting on `target` may refresh: never on a surface that pans itself (the tree
 * canvas, d3-zoom charts and Leaflet maps all set `touch-action: none`), nor inside a panel that
 * is scrolled, where the pull means "scroll back up".
 */
export function canPullFrom(target: EventTarget | null): boolean {
	if ((document.scrollingElement?.scrollTop ?? 0) > 0) return false;
	for (let el = target instanceof Element ? target : null; el; el = el.parentElement) {
		if (el.scrollTop > 0 || getComputedStyle(el).touchAction === 'none') return false;
	}
	return true;
}

/**
 * Follows a one-finger pull down from the top of the page: `onpull` gets the damped distance as it
 * changes (0 when the pull ends), and `onrefresh` runs when it is let go past the threshold.
 * Listeners stay passive, so ordinary scrolling never waits on them. Returns the cleanup.
 */
export function pullToRefresh(onpull: (distancePx: number) => void, onrefresh: () => void) {
	let startY: number | null = null;
	let distancePx = 0;
	const start = (e: TouchEvent) => {
		startY = e.touches.length === 1 && canPullFrom(e.target) ? e.touches[0].clientY : null;
	};
	const move = (e: TouchEvent) => {
		if (startY === null) return;
		distancePx = Math.min(MAX_PULL_PX, Math.max(0, (e.touches[0].clientY - startY) * PULL_DAMPING));
		onpull(distancePx);
	};
	const end = (e: TouchEvent) => {
		// A cancelled touch (the system took the gesture) is not a release, so it never refreshes.
		if (e.type === 'touchend' && startY !== null && distancePx >= PULL_THRESHOLD_PX) onrefresh();
		startY = null;
		distancePx = 0;
		onpull(0);
	};
	window.addEventListener('touchstart', start, { passive: true });
	window.addEventListener('touchmove', move, { passive: true });
	window.addEventListener('touchend', end);
	window.addEventListener('touchcancel', end);
	return () => {
		window.removeEventListener('touchstart', start);
		window.removeEventListener('touchmove', move);
		window.removeEventListener('touchend', end);
		window.removeEventListener('touchcancel', end);
	};
}
