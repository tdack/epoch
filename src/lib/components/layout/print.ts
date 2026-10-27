/**
 * Closed disclosures print closed, so the citations and notes folded under a fact would be missing
 * from paper. This opens them for the print and closes the same ones after. A script rather than
 * `::details-content`, which only the newest browsers style.
 */

/** Opens every closed `<details>` under `root`; the returned function closes those again. */
export function openForPrint(root: Element | Document): () => void {
	const opened = [...root.querySelectorAll<HTMLDetailsElement>('details:not([open])')];
	for (const details of opened) details.open = true;
	return () => {
		for (const details of opened) details.open = false;
	};
}

/**
 * Listens for the browser's print events for as long as the caller lives: `before` runs as the
 * print dialog opens, and the function it returns runs after. Returns the cleanup for an `$effect`.
 */
export function onPrint(before: () => () => void): () => void {
	let after: (() => void) | null = null;
	const start = () => {
		after?.();
		after = before();
	};
	const end = () => {
		after?.();
		after = null;
	};
	window.addEventListener('beforeprint', start);
	window.addEventListener('afterprint', end);
	return () => {
		window.removeEventListener('beforeprint', start);
		window.removeEventListener('afterprint', end);
		end();
	};
}
