/**
 * The standard GEDCOM spelling of a date someone typed loosely: `3 RD DECEMBER 1996` is
 * `3 DEC 1996`, `JANUAY` is `JAN`, `CIRCA 1937` is `ABT 1937`. Files from other programs are full of
 * these, and the meaning is never in doubt, so Epoch reads them and can offer the standard form.
 *
 * Pure text, and conservative: only a word that can mean one thing is changed. Whether the result is
 * a readable date is for the caller to check (`standardDateText` in `date-value.ts`); text this
 * cannot make sense of comes back as it went in, apart from spacing and capitals.
 */

const MONTHS = [
	'JANUARY',
	'FEBRUARY',
	'MARCH',
	'APRIL',
	'MAY',
	'JUNE',
	'JULY',
	'AUGUST',
	'SEPTEMBER',
	'OCTOBER',
	'NOVEMBER',
	'DECEMBER'
] as const;

const KEYWORDS: Record<string, string> = {
	ABOUT: 'ABT',
	CIRCA: 'ABT',
	CA: 'ABT',
	'CA.': 'ABT',
	'C.': 'ABT',
	'ABT.': 'ABT',
	BEFORE: 'BEF',
	'BEF.': 'BEF',
	AFTER: 'AFT',
	'AFT.': 'AFT',
	BETWEEN: 'BET',
	ESTIMATED: 'EST',
	CALCULATED: 'CAL',
	SEPT: 'SEP'
};

/** Edit distance, for telling a misspelt month from a word that only starts like one. */
function distance(a: string, b: string): number {
	let previous = Array.from({ length: b.length + 1 }, (_, j) => j);
	for (let i = 1; i <= a.length; i++) {
		const row = [i];
		for (let j = 1; j <= b.length; j++) {
			row[j] = Math.min(
				previous[j] + 1,
				row[j - 1] + 1,
				previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
			);
		}
		previous = row;
	}
	return previous[b.length];
}

/**
 * A month's three-letter code for a word that is plainly that month: its full name, or a
 * misspelling that keeps the first three letters and is within two edits of a name of five or
 * more. May, June and July are matched only exactly: too many real words (`MAYBE`, `JUNK`) are
 * two edits from a name that short.
 */
function monthCode(word: string): string | null {
	for (const name of MONTHS) {
		const code = name.slice(0, 3);
		if (word === name) return code;
		if (name.length < 5 || word.length < 4 || !word.startsWith(code)) continue;
		if (distance(word, name) <= 2) return code;
	}
	return null;
}

function tidyWords(text: string): string {
	return (
		text
			.toUpperCase()
			.replace(/\s+/g, ' ')
			.trim()
			// An ordinal day, written `3RD` or `3 RD`.
			.replace(/\b(\d{1,2}) ?(ST|ND|RD|TH)\b/g, '$1')
			.split(' ')
			.map((word) => KEYWORDS[word] ?? (/^[A-Z]{4,}$/.test(word) ? monthCode(word) : null) ?? word)
			.join(' ')
	);
}

/**
 * The text in standard GEDCOM spelling. A phrase in brackets is the person's own words and is left
 * exactly as written, whether it is the whole date or follows `INT`.
 */
export function tidyDateText(raw: string): string {
	const text = raw.trim();
	if (text.startsWith('(') && text.endsWith(')')) return text;
	const phrase = text.indexOf('(');
	if (phrase === -1) return tidyWords(text);
	return `${tidyWords(text.slice(0, phrase))} ${text.slice(phrase).trim()}`;
}

/**
 * How many dates one "standardise dates" change rewrites. One change is one atomic batch and one
 * log row, as for a place rewrite (`MAX_PLACE_REWRITE_FACTS`); a tree with more is done in turns.
 */
export const MAX_DATE_REWRITES = 200;

/** One date the standardise action would rewrite, as the preview lists it. */
export interface DateTidyChange {
	/** What the date is on, such as "Death of Wilbur Clancy Bouvier". */
	label: string;
	before: string;
	after: string;
}

export interface DateTidyPreview {
	/** The dates this turn would rewrite, at most `MAX_DATE_REWRITES`. */
	changes: DateTidyChange[];
	/** Dates beyond this turn, for the next one. */
	remaining: number;
}
