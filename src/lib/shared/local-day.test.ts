import { describe, expect, it } from 'vitest';
import { localDayRange, resolveTimeZone } from './local-day';

const iso = (ms: number) => new Date(ms).toISOString();

describe('localDayRange', () => {
	it('is the UTC day in UTC', () => {
		const r = localDayRange('2026-03-02', 'UTC');
		expect([iso(r.start), iso(r.end)]).toEqual([
			'2026-03-02T00:00:00.000Z',
			'2026-03-03T00:00:00.000Z'
		]);
	});

	it('starts a day 10:30 early in Adelaide in January (+10:30)', () => {
		const r = localDayRange('2026-01-20', 'Australia/Adelaide');
		expect([iso(r.start), iso(r.end)]).toEqual([
			'2026-01-19T13:30:00.000Z',
			'2026-01-20T13:30:00.000Z'
		]);
	});

	it('uses +09:30 in Adelaide in winter', () => {
		expect(iso(localDayRange('2026-07-01', 'Australia/Adelaide').start)).toBe(
			'2026-06-30T14:30:00.000Z'
		);
	});

	it('makes the changeover days 23 and 25 hours long', () => {
		const hours = (day: string, zone: string) => {
			const r = localDayRange(day, zone);
			return (r.end - r.start) / 3_600_000;
		};
		// Adelaide springs forward on 2026-10-04 and falls back on 2026-04-05.
		expect(hours('2026-10-04', 'Australia/Adelaide')).toBe(23);
		expect(hours('2026-04-05', 'Australia/Adelaide')).toBe(25);
		expect(hours('2026-03-08', 'America/New_York')).toBe(23);
		expect(hours('2026-03-09', 'America/New_York')).toBe(24);
	});

	it('reads an unknown zone as UTC', () => {
		expect(localDayRange('2026-03-02', 'Not/AZone')).toEqual(localDayRange('2026-03-02', 'UTC'));
		expect(resolveTimeZone('Not/AZone')).toBe('UTC');
		expect(resolveTimeZone(null)).toBe('UTC');
		expect(resolveTimeZone('Australia/Adelaide')).toBe('Australia/Adelaide');
	});
});
