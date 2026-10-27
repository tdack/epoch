/** One all-day event that comes round every year, on the day it first happened. */
export interface IcsAnniversary {
	/** Stable across downloads, so a calendar app updates the event instead of adding a copy. */
	uid: string;
	summary: string;
	year: number;
	month: number;
	day: number;
}

/** RFC 5545 §3.1: a content line is at most 75 octets, folded with CRLF and one space. */
const MAX_LINE_OCTETS = 75;

const encoder = new TextEncoder();

/** RFC 5545 §3.3.11. Backslash first, so the ones added next are not doubled. */
const escapeText = (text: string) =>
	text
		.replaceAll('\\', '\\\\')
		.replaceAll(';', '\\;')
		.replaceAll(',', '\\,')
		.replace(/\r?\n/g, '\\n');

/** Folds between characters, never inside a multi-byte one; the leading space of a continuation counts. */
function fold(line: string): string {
	const out: string[] = [];
	let current = '';
	let octets = 0;
	for (const char of line) {
		const size = encoder.encode(char).length;
		if (octets + size > MAX_LINE_OCTETS) {
			out.push(current);
			current = ' ';
			octets = 1;
		}
		current += char;
		octets += size;
	}
	out.push(current);
	return out.join('\r\n');
}

const pad = (n: number, width: number) => String(n).padStart(width, '0');
const dateValue = (year: number, month: number, day: number) =>
	`${pad(year, 4)}${pad(month, 2)}${pad(day, 2)}`;

/**
 * An iCalendar file of yearly all-day events. `stamp` is passed in (UTC, `YYYYMMDDTHHMMSSZ`) so the
 * function stays pure and a test can pin it. A 29 February recurs only in leap years, as the format
 * defines.
 */
export function toIcs(events: readonly IcsAnniversary[], stamp: string): string {
	const lines = [
		'BEGIN:VCALENDAR',
		'VERSION:2.0',
		'PRODID:-//Epoch//Anniversaries//EN',
		'CALSCALE:GREGORIAN',
		...events.flatMap((e) => [
			'BEGIN:VEVENT',
			`UID:${e.uid}`,
			`DTSTAMP:${stamp}`,
			`DTSTART;VALUE=DATE:${dateValue(e.year, e.month, e.day)}`,
			'RRULE:FREQ=YEARLY',
			`SUMMARY:${escapeText(e.summary)}`,
			'END:VEVENT'
		]),
		'END:VCALENDAR'
	];
	return lines.map(fold).join('\r\n') + '\r\n';
}
