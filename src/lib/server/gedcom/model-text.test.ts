/**
 * Model text on import: GEDCOM's banned code points are dropped, and a leading `@` the file wrote
 * as `@@` is restored as text — in both dialects — while a real pointer stays a pointer. The
 * distinction has to be made from the file's own bytes, not the cleaned-up value, or text that is
 * exactly a pointer (`@I1@`) reads as a reference.
 */

import { describe, expect, it } from 'vitest';
import { stripBannedChars } from './evidence-lines';
import { parseGedcom } from './parser';

const file = (version: string, body: string[]) =>
	['0 HEAD', '1 GEDC', `2 VERS ${version}`, ...body, '0 TRLR'].join('\n');

const noteTextOf = (version: string, noteLine: string) =>
	parseGedcom(file(version, ['0 @I1@ INDI', '1 NAME Ann /Ash/', noteLine])).individuals[0]
		.notes?.[0];

const citationOf = (sourLine: string) =>
	parseGedcom(
		file('5.5.1', ['0 @I1@ INDI', '1 NAME Ann /Ash/', sourLine, '0 @S1@ SOUR', '1 TITL Source'])
	).individuals[0].citations?.[0];

describe.each(['5.5.1', '7.0'])('an escaped leading @ in %s is text, not a pointer', (version) => {
	it('restores a note whose text is exactly a pointer', () => {
		const note = noteTextOf(version, '1 NOTE @@N1@');
		expect(note).toMatchObject({ text: '@N1@' });
		expect(note?.pointer).toBeUndefined();
	});

	it('keeps a real pointer a pointer', () => {
		expect(noteTextOf(version, '1 NOTE @N1@')).toMatchObject({ pointer: '@N1@' });
	});

	it('never unescapes a CONC value, whose @@ is mid-text', () => {
		const note = noteTextOf(version, '1 NOTE @@start\n2 CONC @@mid');
		expect(note?.text).toBe('@start@@mid');
	});
});

describe('pointer classification reads the file bytes', () => {
	it('reads @@S1@ under a citation as inline text, not a pointer', () => {
		const citation = citationOf('1 SOUR @@S1@');
		expect(citation?.pointer).toBeUndefined();
		expect(citation?.description).toBe('@S1@');
	});

	it('still reads @S1@ under a citation as a pointer', () => {
		expect(citationOf('1 SOUR @S1@')?.pointer).toBe('@S1@');
	});

	it('does not turn a control-code-led payload into a pointer', () => {
		const note = noteTextOf('5.5.1', '1 NOTE \x01@N1@');
		expect(note?.pointer).toBeUndefined();
		expect(note?.text).toBe('@N1@');
	});
});

describe('banned code points are removed from model text, astral characters kept', () => {
	it('drops a C0 control but keeps a TAB', () => {
		expect(stripBannedChars('a\x01b\tc')).toBe('ab\tc');
	});

	it('keeps a valid surrogate pair whole and drops a lone one', () => {
		expect(stripBannedChars('a\u{1f600}b')).toBe('a\u{1f600}b');
		expect(stripBannedChars('a\ud800b')).toBe('ab');
		expect(stripBannedChars('a\udc00b')).toBe('ab');
	});

	it('cleans a value the import stores as text', () => {
		expect(noteTextOf('5.5.1', '1 NOTE \x02clean')?.text).toBe('clean');
	});
});
