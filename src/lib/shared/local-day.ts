/**
 * The epoch-millisecond bounds of a calendar day in a named time zone (ADR-068). Each bound is
 * worked out from that day's own offset, so a day with a daylight-saving changeover is 23 or 25
 * hours long rather than shifted by a fixed offset.
 */

const FALLBACK_TIME_ZONE = 'UTC';

/** The zone if the runtime knows it, else UTC; the zone arrives from an address, so it can be anything. */
export function resolveTimeZone(zone: string | null | undefined): string {
	if (!zone) return FALLBACK_TIME_ZONE;
	try {
		return new Intl.DateTimeFormat('en-US', { timeZone: zone }).resolvedOptions().timeZone;
	} catch {
		return FALLBACK_TIME_ZONE;
	}
}

/** Milliseconds the zone is ahead of UTC at this instant. */
function offsetAt(ms: number, zone: string): number {
	const parts = new Intl.DateTimeFormat('en-US', {
		timeZone: zone,
		hourCycle: 'h23',
		year: 'numeric',
		month: 'numeric',
		day: 'numeric',
		hour: 'numeric',
		minute: 'numeric',
		second: 'numeric'
	}).formatToParts(ms);
	const at = (type: string) => Number(parts.find((p) => p.type === type)!.value);
	const wallAsUtc = Date.UTC(
		at('year'),
		at('month') - 1,
		at('day'),
		at('hour'),
		at('minute'),
		at('second')
	);
	return wallAsUtc - Math.floor(ms / 1000) * 1000;
}

/** The instant the zone's wall clock reads midnight at the start of `year-month-day` (month 1-12). */
function startOfDay(year: number, month: number, day: number, zone: string): number {
	const wall = Date.UTC(year, month - 1, day);
	// The offset at the guess may be the other side of a changeover, so settle with a second pass.
	const first = wall - offsetAt(wall, zone);
	return wall - offsetAt(first, zone);
}

/**
 * `[start, end)` of the local day `YYYY-MM-DD` in `zone`: `start` is its first instant and `end`
 * the first instant of the next day. An unknown zone is read as UTC.
 */
export function localDayRange(day: string, zone: string): { start: number; end: number } {
	const resolved = resolveTimeZone(zone);
	const [year, month, date] = day.split('-').map(Number) as [number, number, number];
	const next = new Date(Date.UTC(year, month - 1, date + 1));
	return {
		start: startOfDay(year, month, date, resolved),
		end: startOfDay(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), resolved)
	};
}
