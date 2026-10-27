import { describe, expect, it } from 'vitest';
import { toIcs } from './ics';

const STAMP = '20261028T000000Z';
const event = (summary: string, uid = 'e1@epoch') => ({
	uid,
	summary,
	year: 1956,
	month: 5,
	day: 12
});

describe('toIcs', () => {
	it('writes a yearly all-day event with CRLF line ends', () => {
		const ics = toIcs([event('Homer Simpson born')], STAMP);
		expect(ics).toBe(
			[
				'BEGIN:VCALENDAR',
				'VERSION:2.0',
				'PRODID:-//Epoch//Anniversaries//EN',
				'CALSCALE:GREGORIAN',
				'BEGIN:VEVENT',
				'UID:e1@epoch',
				'DTSTAMP:20261028T000000Z',
				'DTSTART;VALUE=DATE:19560512',
				'RRULE:FREQ=YEARLY',
				'SUMMARY:Homer Simpson born',
				'END:VEVENT',
				'END:VCALENDAR',
				''
			].join('\r\n')
		);
		expect(ics.replaceAll('\r\n', '')).not.toMatch(/[\r\n]/);
	});

	it('escapes commas, semicolons, backslashes and newlines', () => {
		const ics = toIcs([event('a,b;c\\d\ne')], STAMP);
		expect(ics).toContain('SUMMARY:a\\,b\\;c\\\\d\\ne\r\n');
	});

	it('folds a long line at 75 octets without splitting a character', () => {
		const ics = toIcs([event('é'.repeat(100))], STAMP);
		const lines = ics.split('\r\n');
		const start = lines.findIndex((l) => l.startsWith('SUMMARY:'));
		const octets = (s: string) => new TextEncoder().encode(s).length;
		expect(octets(lines[start]!)).toBeLessThanOrEqual(75);
		expect(lines[start + 1]!.startsWith(' ')).toBe(true);
		expect(lines.every((l) => octets(l) <= 75)).toBe(true);
		const unfolded = ics.replaceAll('\r\n ', '');
		expect(unfolded).toContain(`SUMMARY:${'é'.repeat(100)}`);
	});

	it('keeps the uid it was given, so a second download matches the first', () => {
		const events = [event('x', 'a@epoch'), event('y', 'b@epoch')];
		expect(toIcs(events, STAMP)).toBe(toIcs(events, STAMP));
		expect(toIcs(events, STAMP)).toContain('UID:a@epoch\r\n');
		expect(toIcs(events, STAMP)).toContain('UID:b@epoch\r\n');
	});
});
