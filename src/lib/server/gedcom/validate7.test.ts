import { describe, expect, it } from 'vitest';
import {
	GEDCOM7_ISSUE_CODES,
	validateGedcom7,
	type Gedcom7Issue,
	type Gedcom7IssueCode
} from './validate7';

const HEAD = '0 HEAD\n1 GEDC\n2 VERS 7.0\n';
const TRLR = '0 TRLR\n';

/** A file with `body` between a valid header and trailer. */
const file = (body: string) => HEAD + body + TRLR;
/** A file whose header also carries `schma` (lines at level 2 under SCHMA). */
const withSchema = (schma: string, body = '') => HEAD + `1 SCHMA\n${schma}` + body + TRLR;

const codesOf = (issues: Gedcom7Issue[]) => issues.map((issue) => issue.code);
const errorCodes = (text: string) => codesOf(validateGedcom7(text).errors);
const warningCodes = (text: string) => codesOf(validateGedcom7(text).warnings);

/** The code appears for `bad` and not for `good`, which is clean of errors. */
function expectError(code: Gedcom7IssueCode, bad: string, good: string) {
	expect(validateGedcom7(good).errors).toEqual([]);
	expect(errorCodes(bad)).toContain(code);
}

describe('line grammar', () => {
	it('line-grammar', () => {
		expectError('line-grammar', file('0 @I1@ INDI\n1  NAME x\n'), file('0 @I1@ INDI\n1 NAME x\n'));
		expect(errorCodes(file('0 @I1@ INDI\n1 name x\n'))).toContain('line-grammar');
		expect(errorCodes(file('0 @I1@ INDI\n\n1 NAME x\n'))).toContain('line-grammar');
		expect(errorCodes(file('0 @I1@ INDI\n01 NAME x\n'))).toContain('line-grammar');
	});

	it('conc-unsupported', () => {
		expectError(
			'conc-unsupported',
			file('0 @I1@ INDI\n1 NOTE a\n2 CONC b\n'),
			file('0 @I1@ INDI\n1 NOTE a\n2 CONT b\n')
		);
	});

	it('control-character', () => {
		expectError(
			'control-character',
			file('0 @I1@ INDI\n1 NOTE a\u0001b\n'),
			file('0 @I1@ INDI\n1 NOTE a\tb\n')
		);
	});

	it('level-jump', () => {
		expectError('level-jump', file('0 @I1@ INDI\n2 NAME x\n'), file('0 @I1@ INDI\n1 NAME x\n'));
	});

	it('at-sign-escape: only a leading @ must be doubled', () => {
		expectError(
			'at-sign-escape',
			file('0 @I1@ INDI\n1 NOTE @me\n'),
			file('0 @I1@ INDI\n1 NOTE @@me and a@b and @@@@\n')
		);
	});

	it('terminator-mixed is a warning; CR, LF and CRLF alone are fine', () => {
		const lf = file('');
		expect(warningCodes(lf.replace('\n', '\r\n'))).toContain('terminator-mixed');
		expect(validateGedcom7(lf.replaceAll('\n', '\r\n'))).toEqual({ errors: [], warnings: [] });
		expect(validateGedcom7(lf.replaceAll('\n', '\r'))).toEqual({ errors: [], warnings: [] });
	});
});

describe('records', () => {
	it('head-not-first', () => {
		expectError('head-not-first', '0 @I1@ INDI\n' + file(''), file(''));
		expect(errorCodes('')).toContain('head-not-first');
	});

	it('trlr-not-last', () => {
		expectError('trlr-not-last', file('') + '0 @I1@ INDI\n', file(''));
	});

	it('root-cardinality', () => {
		expectError('root-cardinality', HEAD + HEAD + TRLR, file(''));
		expect(errorCodes(HEAD + TRLR + TRLR)).toContain('root-cardinality');
	});

	it('root-tag-unknown', () => {
		expectError('root-tag-unknown', file('0 @X@ FOO\n'), file('0 @X@ _FOO\n'));
	});

	it('xref-format', () => {
		expectError('xref-format', file('0 @i1@ INDI\n'), file('0 @I_1@ INDI\n'));
	});

	it('xref-void-reserved', () => {
		expectError('xref-void-reserved', file('0 @VOID@ INDI\n'), file('0 @V@ INDI\n'));
	});

	it('xref-duplicate', () => {
		expectError(
			'xref-duplicate',
			file('0 @I1@ INDI\n0 @I1@ INDI\n'),
			file('0 @I1@ INDI\n0 @I2@ INDI\n')
		);
	});

	it('xref-misplaced', () => {
		expectError(
			'xref-misplaced',
			file('0 @I1@ INDI\n1 @X@ NOTE a\n'),
			file('0 @I1@ INDI\n1 NOTE a\n')
		);
		expect(errorCodes('0 @H@ HEAD\n1 GEDC\n2 VERS 7.0\n' + TRLR)).toContain('xref-misplaced');
	});

	it('xref-missing is a warning', () => {
		expect(warningCodes(file('0 INDI\n'))).toContain('xref-missing');
		expect(warningCodes(file('0 @I1@ INDI\n'))).not.toContain('xref-missing');
	});
});

describe('structure', () => {
	it('tag-not-allowed', () => {
		expectError(
			'tag-not-allowed',
			file('0 @I1@ INDI\n1 HUSB @VOID@\n'),
			file('0 @F1@ FAM\n1 HUSB @VOID@\n')
		);
		expect(errorCodes(file('0 @I1@ INDI\n1 NOTE a\n2 CONT b\n3 CONT c\n'))).toContain(
			'tag-not-allowed'
		);
		expect(errorCodes(file('0 @I1@ INDI\n1 SEX M\n2 CONT b\n'))).toContain('tag-not-allowed');
	});

	it('resolves a tag by its parent: DATE differs under CHAN and under an event', () => {
		expect(errorCodes(file('0 @I1@ INDI\n1 BIRT\n2 DATE ABT 1900\n'))).toEqual([]);
		expect(errorCodes(file('0 @I1@ INDI\n1 CHAN\n2 DATE ABT 1900\n'))).toEqual(['date-exact']);
	});

	it('cardinality-max', () => {
		expectError(
			'cardinality-max',
			file('0 @I1@ INDI\n1 SEX M\n1 SEX F\n'),
			file('0 @I1@ INDI\n1 NAME a\n1 NAME b\n')
		);
	});

	it('cardinality-min', () => {
		expectError(
			'cardinality-min',
			file('0 @I1@ INDI\n1 ASSO @VOID@\n'),
			file('0 @I1@ INDI\n1 ASSO @VOID@\n2 ROLE CHIL\n')
		);
		expect(errorCodes('0 HEAD\n' + TRLR)).toContain('cardinality-min');
	});
});

describe('payloads', () => {
	it('payload-unexpected', () => {
		expectError('payload-unexpected', file('0 @I1@ INDI x\n'), file('0 @I1@ INDI\n'));
		// A pointer where text is wanted is the same mistake.
		expect(errorCodes(file('0 @I1@ INDI\n1 NOTE @I1@\n'))).toContain('payload-unexpected');
	});

	it('payload-missing', () => {
		expectError(
			'payload-missing',
			file('0 @I1@ INDI\n1 ASSO\n2 ROLE CHIL\n'),
			file('0 @I1@ INDI\n1 ASSO @VOID@\n2 ROLE CHIL\n')
		);
		expect(errorCodes(file('0 @I1@ INDI\n1 BIRT\n2 AGE\n'))).toContain('payload-missing');
		expect(errorCodes(file('0 @I1@ INDI\n1 BIRT\n2 AGE\n3 PHRASE unknown\n'))).toEqual([]);
	});

	it('pointer-format', () => {
		expectError(
			'pointer-format',
			file('0 @I1@ INDI\n1 ASSO plain\n2 ROLE CHIL\n'),
			file('0 @I1@ INDI\n1 ASSO @I1@\n2 ROLE CHIL\n')
		);
		expect(errorCodes(file('0 @I1@ INDI\n1 ASSO @@I1@\n2 ROLE CHIL\n'))).toContain(
			'pointer-format'
		);
	});

	it('pointer-unresolved accepts @VOID@ for any pointer', () => {
		expectError(
			'pointer-unresolved',
			file('0 @I1@ INDI\n1 FAMC @F9@\n'),
			file('0 @I1@ INDI\n1 FAMC @VOID@\n1 SUBM @VOID@\n1 ASSO @VOID@\n2 ROLE CHIL\n')
		);
	});

	it('pointer-wrong-type', () => {
		expectError(
			'pointer-wrong-type',
			file('0 @I1@ INDI\n1 FAMC @I1@\n'),
			file('0 @I1@ INDI\n1 FAMC @F1@\n0 @F1@ FAM\n')
		);
	});

	it('enum-value, including list enumerations and extension values', () => {
		expectError('enum-value', file('0 @I1@ INDI\n1 SEX Q\n'), file('0 @I1@ INDI\n1 SEX M\n'));
		const data = (v: string) => file(`0 @S1@ SOUR\n1 DATA\n2 EVEN ${v}\n`);
		expect(errorCodes(data('BIRT, DEAT'))).toEqual([]);
		expect(errorCodes(data('BIRT,DEAT'))).toEqual([]);
		expect(errorCodes(data('BIRT, XXXX'))).toContain('enum-value');
		expect(errorCodes(file('0 @I1@ INDI\n1 SEX _OTHER\n'))).toEqual([]);
	});

	it('y-or-null', () => {
		expectError(
			'y-or-null',
			file('0 @I1@ INDI\n1 BIRT N\n'),
			file('0 @I1@ INDI\n1 BIRT Y\n1 DEAT\n')
		);
	});

	it('integer', () => {
		expectError('integer', file('0 @I1@ INDI\n1 NCHI x\n'), file('0 @I1@ INDI\n1 NCHI 3\n'));
		expect(errorCodes(file('0 @I1@ INDI\n1 NCHI -1\n'))).toContain('integer');
	});

	it('language: BCP 47 well-formedness, not the registry', () => {
		const lang = (v: string) => file(`0 @I1@ INDI\n1 NOTE a\n2 LANG ${v}\n`);
		for (const ok of ['en', 'en-GB', 'zh-Hant-TW', 'sl-rozaj-biske', 'x-private', 'qaa'])
			expect(errorCodes(lang(ok)), ok).toEqual([]);
		for (const bad of ['English language', 'e', 'Engl1shlanguage', 'en_GB', 'en-', 'en-GB-'])
			expect(errorCodes(lang(bad)), bad).toContain('language');
	});

	it('media-type', () => {
		expectError(
			'media-type',
			file('0 @I1@ INDI\n1 NOTE a\n2 MIME text\n'),
			file('0 @I1@ INDI\n1 NOTE a\n2 MIME text/plain\n')
		);
	});

	it('uri', () => {
		expectError(
			'uri',
			file('0 @I1@ INDI\n1 EXID 1\n2 TYPE no-scheme\n'),
			file('0 @I1@ INDI\n1 EXID 1\n2 TYPE https://example.com/x\n')
		);
	});

	it('personal-name: no slashes or exactly one surname', () => {
		expectError(
			'personal-name',
			file('0 @I1@ INDI\n1 NAME A /B C\n'),
			file('0 @I1@ INDI\n1 NAME A /B/ C\n1 NAME Madonna\n1 NAME\n')
		);
	});

	it('latitude and longitude', () => {
		const map = (lat: string, lon: string) =>
			file(`0 @I1@ INDI\n1 BIRT\n2 PLAC x\n3 MAP\n4 LATI ${lat}\n4 LONG ${lon}\n`);
		expect(errorCodes(map('N12.5', 'W0.1'))).toEqual([]);
		expect(errorCodes(map('12.5', 'W0.1'))).toContain('latitude');
		expect(errorCodes(map('N91', 'W0.1'))).toContain('latitude');
		expect(errorCodes(map('N1', 'N1'))).toContain('longitude');
		expect(errorCodes(map('N1', 'E181'))).toContain('longitude');
	});

	it('time', () => {
		const time = (v: string) => file(`0 @I1@ INDI\n1 CHAN\n2 DATE 1 JAN 2000\n3 TIME ${v}\n`);
		for (const ok of ['12:00', '8:38', '23:59:59', '00:00:01.25Z'])
			expect(errorCodes(time(ok))).toEqual([]);
		for (const bad of ['24:00', '12:60', '12', '12:00:00.', 'noon'])
			expect(errorCodes(time(bad)), bad).toContain('time');
	});

	it('age', () => {
		const age = (v: string) => file(`0 @I1@ INDI\n1 CHR\n2 AGE ${v}\n`);
		for (const ok of ['10y', '> 10y 3m 2w 1d', '< 0d', '3m 1d', '2w'])
			expect(errorCodes(age(ok)), ok).toEqual([]);
		for (const bad of ['3m 10y', '10', '>10y', '10y 10y', '> ', 'y'])
			expect(errorCodes(age(bad)), bad).toContain('age');
	});
});

describe('dates', () => {
	const date = (v: string) => file(`0 @I1@ INDI\n1 BIRT\n2 DATE ${v}\n`);

	it('date-value accepts the grammar, calendars, BCE and extension parts', () => {
		for (const ok of [
			'',
			'1900',
			'MAR 1900',
			'4 MAR 1900',
			'4 MAR 1900 BCE',
			'JULIAN 4 MAR 1900',
			'GREGORIAN 1601 BCE',
			'HEBREW 5 TSH 5000',
			'FRENCH_R 2 VEND 8',
			'ABT 1900',
			'CAL 1900',
			'EST 1900',
			'BEF 4 MAR 1900',
			'AFT 1900',
			'BET 1900 AND 1910',
			'BET JULIAN 1 JAN 1000 AND 1 JAN 1001',
			'FROM 1900',
			'TO 1900',
			'FROM 1900 TO 1910',
			'_CAL 8 _MONTH 190 _EPOCH',
			'FRENCH_R 2 _JOUR 8'
		])
			expect(errorCodes(date(ok)), ok).toEqual([]);
	});

	it('date-value rejects what the grammar does not allow', () => {
		for (const bad of [
			'1648/49',
			'4 MARCH 1900',
			'4 VEND 1900',
			'FRENCH_R 4 JAN 8',
			'FRENCH_R 4 VEND 8 BCE',
			'HEBREW 4 TSH 5000 BCE',
			'BET 1900',
			'BET 1900 AND',
			'ABT',
			'ABT ABT 1900',
			'1900  1',
			'MAR',
			'abt 1900',
			'4 MAR 1900 AD',
			'1 2 MAR 1900'
		])
			expect(errorCodes(date(bad)), bad).toContain('date-value');
	});

	it('date-period requires FROM or TO', () => {
		const period = (v: string) => file(`0 @S1@ SOUR\n1 DATA\n2 EVEN BIRT\n3 DATE ${v}\n`);
		expect(errorCodes(period('FROM 1900 TO 1910'))).toEqual([]);
		expect(errorCodes(period('TO 1900'))).toEqual([]);
		expect(errorCodes(period('1900'))).toContain('date-period');
		expect(errorCodes(period('ABT 1900'))).toContain('date-period');
		expect(errorCodes(period('FROM 1900 TO'))).toContain('date-period');
	});

	it('date-exact is day month year, Gregorian', () => {
		const chan = (v: string) => file(`0 @I1@ INDI\n1 CHAN\n2 DATE ${v}\n`);
		expect(errorCodes(chan('1 JAN 2000'))).toEqual([]);
		for (const bad of ['JAN 2000', '2000', 'JULIAN 1 JAN 2000', '1 JAN 2000 BCE', '1 JAN'])
			expect(errorCodes(chan(bad)), bad).toContain('date-exact');
	});
});

describe('extensions', () => {
	it('does not check below an extension tag, and allows one anywhere', () => {
		const body =
			'0 @I1@ INDI\n1 _FOO whatever\n2 NOTE not checked\n3 HUSB nonsense\n1 BIRT\n2 _BAR x\n';
		expect(errorCodes(file(body))).toEqual([]);
	});

	it('rejects a non-underscore tag the table does not know there (tag-not-allowed)', () => {
		expect(errorCodes(file('0 @I1@ INDI\n1 FOO x\n'))).toContain('tag-not-allowed');
	});

	it('extension-undocumented is a warning, cleared by a SCHMA entry', () => {
		const body = '0 @I1@ INDI\n1 _FOO x\n';
		expect(validateGedcom7(file(body)).errors).toEqual([]);
		expect(warningCodes(file(body))).toEqual(['extension-undocumented']);
		expect(warningCodes(withSchema('2 TAG _FOO https://example.com/foo\n', body))).toEqual([]);
	});

	it('warns about an undocumented extension enumeration value and date part', () => {
		expect(warningCodes(file('0 @I1@ INDI\n1 SEX _X\n'))).toContain('extension-undocumented');
		expect(warningCodes(file('0 @I1@ INDI\n1 BIRT\n2 DATE _CAL 1 _M 2\n'))).toContain(
			'extension-undocumented'
		);
	});

	it('a SCHMA tag may alias a standard record type for pointers', () => {
		const text = withSchema(
			'2 TAG _USER https://gedcom.io/terms/v7/record-SUBM\n',
			'0 @U1@ _USER\n0 @I1@ INDI\n1 SUBM @U1@\n'
		);
		expect(validateGedcom7(text)).toEqual({ errors: [], warnings: [] });
	});

	it('tag-def: SCHMA TAG needs a tag and a URI', () => {
		expectError(
			'tag-def',
			withSchema('2 TAG _FOO\n'),
			withSchema('2 TAG _FOO https://example.com/foo\n')
		);
		expect(errorCodes(withSchema('2 TAG _FOO not-a-uri\n'))).toContain('tag-def');
	});

	it('schma-standard-tag: a standard tag cannot be redefined', () => {
		expectError(
			'schma-standard-tag',
			withSchema('2 TAG NAME https://example.com/name\n'),
			withSchema('2 TAG _NAME https://example.com/name\n')
		);
	});

	it('gedc-version is a warning', () => {
		expect(warningCodes(file('').replace('VERS 7.0', 'VERS 5.5.1'))).toContain('gedc-version');
		expect(warningCodes(file('').replace('VERS 7.0', 'VERS 7.0.18'))).not.toContain('gedc-version');
	});
});

describe('the code list', () => {
	it('has no duplicates', () => {
		expect(new Set(GEDCOM7_ISSUE_CODES).size).toBe(GEDCOM7_ISSUE_CODES.length);
	});
});

// The files are fetched by `npm run gedcom:conformance` and gitignored, so the glob is empty
// on a fresh clone and the suite skips instead of failing.
const official = import.meta.glob<string>('../../../../test/gedcom/conformance/files/*.ged', {
	query: '?raw',
	import: 'default',
	eager: true
});
const names = Object.keys(official);

describe.skipIf(names.length === 0)('the official GEDCOM 7.0 example files', () => {
	it.each(names)('%s has no errors', (name) => {
		const { errors } = validateGedcom7(official[name]);
		expect(errors).toEqual([]);
	});

	it('reads the 52 KB date file quickly', () => {
		const text = official['../../../../test/gedcom/conformance/files/date.ged'];
		const start = performance.now();
		validateGedcom7(text);
		expect(performance.now() - start).toBeLessThan(500);
	});
});
