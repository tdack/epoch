import type { AnniversaryDto } from './overview';

export const MONTH_NAMES = [
	'January',
	'February',
	'March',
	'April',
	'May',
	'June',
	'July',
	'August',
	'September',
	'October',
	'November',
	'December'
] as const;

const GEDCOM_MONTHS = [
	'JAN',
	'FEB',
	'MAR',
	'APR',
	'MAY',
	'JUN',
	'JUL',
	'AUG',
	'SEP',
	'OCT',
	'NOV',
	'DEC'
];

/** A month from `?month=`, 1 to 12; null for anything else, so the caller picks its default. */
export function parseMonth(value: string | null): number | null {
	const n = Number(value);
	return Number.isInteger(n) && n >= 1 && n <= 12 ? n : null;
}

/** The recorded day as GEDCOM text, which the tree's date format then reads: "12 MAY 1956". */
export function anniversaryDateText(a: AnniversaryDto): string {
	const [month, day] = a.monthDay.split('-').map(Number) as [number, number];
	return `${day} ${GEDCOM_MONTHS[month - 1]} ${a.year}`;
}

/** Says "married" only for a recorded marriage fact; that is the only kind listed. */
export function anniversaryWhat(a: AnniversaryDto): string {
	const names = a.people.map((p) => p.name).join(' and ');
	return `${names} ${a.type === 'BIRT' ? 'born' : a.type === 'DEAT' ? 'died' : 'married'}`;
}
