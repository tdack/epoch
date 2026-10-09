/**
 * Dates between GEDCOM dialects. A stored date is the text a person typed or a file held: 5.5.1
 * syntax as a rule, with a 7.0 file's forms kept as they came. 7.0 dropped the calendar escapes
 * (`@#DJULIAN@`), `B.C.`, dual years (`1648/49`) and the parenthesised phrase, and moved the phrase
 * to a `PHRASE` line, so a 7.0 export converts and a 7.0 import converts back.
 *
 * The phrase travels as 5.5.1's `INT date (phrase)` in storage, which keeps both halves and is what
 * a 5.5.1 export writes anyway.
 */

const MONTHS: Record<string, readonly string[]> = {
	GREGORIAN: ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'],
	JULIAN: ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'],
	FRENCH_R: [
		'VEND',
		'BRUM',
		'FRIM',
		'NIVO',
		'PLUV',
		'VENT',
		'GERM',
		'FLOR',
		'PRAI',
		'MESS',
		'THER',
		'FRUC',
		'COMP'
	],
	HEBREW: [
		'TSH',
		'CSH',
		'KSL',
		'TVT',
		'SHV',
		'ADR',
		'ADS',
		'NSN',
		'IYR',
		'SVN',
		'TMZ',
		'AAV',
		'ELL'
	]
};

const ESCAPE_TO_CALENDAR: Record<string, string> = {
	GREGORIAN: 'GREGORIAN',
	JULIAN: 'JULIAN',
	HEBREW: 'HEBREW',
	'FRENCH R': 'FRENCH_R'
};

const FULL_MONTHS: Record<string, string> = {
	JANUARY: 'JAN',
	FEBRUARY: 'FEB',
	MARCH: 'MAR',
	APRIL: 'APR',
	JUNE: 'JUN',
	JULY: 'JUL',
	AUGUST: 'AUG',
	SEPT: 'SEP',
	SEPTEMBER: 'SEP',
	OCTOBER: 'OCT',
	NOVEMBER: 'NOV',
	DECEMBER: 'DEC'
};

const LONG_KEYWORDS: Record<string, string> = {
	ABOUT: 'ABT',
	CIRCA: 'ABT',
	ESTIMATED: 'EST',
	CALCULATED: 'CAL',
	BEFORE: 'BEF',
	AFTER: 'AFT',
	BETWEEN: 'BET'
};

/** One calendar date in 7.0 syntax: `[calendar] [[day] month] year [BCE]`. */
function isDate7(text: string): boolean {
	const m = text.match(
		/^(?:(GREGORIAN|JULIAN|FRENCH_R|HEBREW) )?(?:(?:(\d{1,2}) )?([A-Z]{3,4}) )?(\d+)(?: BCE)?$/
	);
	if (!m) return false;
	const [, calendar = 'GREGORIAN', , month] = m;
	return !month || MONTHS[calendar].includes(month);
}

/** A whole 7.0 `DATE` payload: a date, a range, a period or an approximation. */
function isDateValue7(text: string): boolean {
	const fromTo = text.match(/^FROM (.+) TO (.+)$/);
	if (fromTo) return isDate7(fromTo[1]) && isDate7(fromTo[2]);
	const open = text.match(/^(?:FROM|TO) (.+)$/);
	if (open) return isDate7(open[1]);
	const between = text.match(/^BET (.+) AND (.+)$/);
	if (between) return isDate7(between[1]) && isDate7(between[2]);
	const single = text.match(/^(?:BEF|AFT|ABT|CAL|EST) (.+)$/);
	if (single) return isDate7(single[1]);
	return isDate7(text);
}

/**
 * The stored text in 7.0 syntax, and whether the conversion said less than the original (a dual
 * year becomes its later, Gregorian year). Null when the text is not a date 7.0 can write.
 */
function convertTo7(stored: string): { value: string; isLossy: boolean } | null {
	let isLossy = false;
	let text = stored.toUpperCase().replace(/\s+/g, ' ').trim();
	let isUnknownCalendar = false;
	text = text.replace(/@#D([A-Z ]+?)@ ?/g, (_, name: string) => {
		const calendar = ESCAPE_TO_CALENDAR[name.trim()];
		if (!calendar) isUnknownCalendar = true;
		return calendar ? `${calendar} ` : '';
	});
	// 5.5.1's ROMAN and UNKNOWN calendars were never defined, and 7.0 has no word for them.
	if (isUnknownCalendar) return null;
	text = text
		.replace(/\b(\d+) ?B\.? ?C\.?(?=$| )/g, '$1 BCE')
		.replace(/\b[A-Z]+\b/g, (word) => FULL_MONTHS[word] ?? LONG_KEYWORDS[word] ?? word)
		.replace(/\b(\d{3,4})\/(\d{1,2})\b/g, (_, first: string, tail: string) => {
			isLossy = true;
			let year = Number(first.slice(0, first.length - tail.length) + tail);
			if (year < Number(first)) year += 10 ** tail.length;
			return String(year);
		});
	return isDateValue7(text) ? { value: text, isLossy } : null;
}

/** A stored date as a 7.0 `DATE` payload and the `PHRASE` to write under it, if any. */
export function toGedcom7Date(stored: string): { value: string; phrase?: string } {
	const original = stored.trim();
	if (!original) return { value: '' };
	const phraseOnly = original.match(/^\((.*)\)$/);
	if (phraseOnly) return { value: '', phrase: phraseOnly[1].trim() };
	const interpreted = original.match(/^INT\s+([^(]+?)\s*\((.*)\)$/i);
	if (interpreted) {
		const date = convertTo7(interpreted[1]);
		return date
			? { value: date.value, phrase: interpreted[2].trim() }
			: { value: '', phrase: original };
	}
	const date = convertTo7(original);
	if (!date) return { value: '', phrase: original };
	return date.isLossy ? { value: date.value, phrase: original } : { value: date.value };
}

/** A 7.0 `DATE` payload and its `PHRASE` as the text Epoch stores. */
export function fromGedcom7Date(value: string | undefined, phrase: string | undefined): string {
	const date = value?.trim() ?? '';
	const words = phrase?.trim();
	if (!words) return date;
	return date ? `INT ${date} (${words})` : `(${words})`;
}

const CALENDAR_TO_ESCAPE: Record<string, string> = {
	GREGORIAN: '@#DGREGORIAN@',
	JULIAN: '@#DJULIAN@',
	HEBREW: '@#DHEBREW@',
	FRENCH_R: '@#DFRENCH R@'
};

/** A stored date as a 5.5.1 `DATE` payload: a 7.0 file's calendar words and `BCE` written the 5.5.1 way. */
export function toGedcom551Date(stored: string): string {
	return stored
		.replace(/(^|\s)(GREGORIAN|JULIAN|HEBREW|FRENCH_R)(?=\s)/g, (_, space, word) => {
			return `${space}${CALENDAR_TO_ESCAPE[word]}`;
		})
		.replace(/(\d) BCE\b/g, '$1 B.C.');
}
