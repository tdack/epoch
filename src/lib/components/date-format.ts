/**
 * The tree's date format, for any component that shows a date. A context, not a prop: like a
 * locale, every leaf that prints a date needs it, and threading one display preference through
 * every screen to every leaf would touch dozens of components for nothing (ADR-079).
 */

import { getContext, setContext } from 'svelte';
import { DEFAULT_DATE_FORMAT, displayDate, type DateFormat } from '#lib/shared/date-display.js';

const KEY = Symbol('epoch-date-format');

/** The tree layout sets this; a getter, so a changed setting re-renders the dates that read it. */
export function setDateFormat(read: () => DateFormat): void {
	setContext(KEY, read);
}

/**
 * Call during component setup. The returned function formats a stored date for display, and falls
 * back to the default outside a tree (account pages, component tests).
 */
export function dateReader(): (raw: string | null | undefined) => string {
	const read = getContext<(() => DateFormat) | undefined>(KEY);
	return (raw) => displayDate(raw, read?.() ?? DEFAULT_DATE_FORMAT);
}

/**
 * Call during component setup, for code that builds a whole string from a date (a shared helper)
 * rather than printing one. Read it where it is used, so a changed setting is picked up.
 */
export function dateFormatReader(): () => DateFormat {
	const read = getContext<(() => DateFormat) | undefined>(KEY);
	return () => read?.() ?? DEFAULT_DATE_FORMAT;
}
