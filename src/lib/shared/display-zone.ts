/**
 * Dates a reader sees on pages the server renders first (ADR-068). The browser reports its zone in a
 * cookie; the server formats with it, and the client formats with the same value from the page data,
 * so the first HTML and the hydrated page print identical text. The locale is fixed for the same
 * reason: `undefined` would pick the server's locale on one side and the browser's on the other.
 */
import { resolveTimeZone } from './local-day.js';

export const TIME_ZONE_COOKIE = 'tz';
const LOCALE = 'en-GB';

/** The zone a cookie value names; UTC when absent or unknown, since the cookie is client-supplied. */
export const zoneFromCookie = (value: string | undefined) => resolveTimeZone(value);

/** `YYYY-MM-DD` of an instant on the wall clock of `zone`. */
export function dayInZone(at: Date, zone: string): string {
	return new Intl.DateTimeFormat('en-CA', {
		timeZone: zone,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit'
	}).format(at);
}

/** The time for an instant on the same day as `now`, else the date: five "26 Oct" stamps would say nothing. */
export function stampOf(at: Date, now: Date, zone: string): string {
	return dayInZone(at, zone) === dayInZone(now, zone)
		? at.toLocaleTimeString(LOCALE, { timeZone: zone, hour: 'numeric', minute: '2-digit' })
		: at.toLocaleDateString(LOCALE, { timeZone: zone, day: 'numeric', month: 'short' });
}

/** A calendar day `days` after `day` (`YYYY-MM-DD`) as "Wed 5 Nov"; UTC arithmetic, so no zone shifts it. */
export function dayLabel(day: string, days: number): string {
	const [year, month, date] = day.split('-').map(Number) as [number, number, number];
	return new Date(Date.UTC(year, month - 1, date + days)).toLocaleDateString(LOCALE, {
		timeZone: 'UTC',
		weekday: 'short',
		day: 'numeric',
		month: 'short'
	});
}
