/**
 * A lone `\r` (old Mac) is a valid GEDCOM line terminator, but the importer and exporter split on
 * `\n` alone. A `\r` inside a value then survives into the model and, on export, is written as a
 * bare second line a reader takes for a new record. These tests hold the fix: every terminator
 * splits on import, and a stray segment is kept as a continuation rather than dropped.
 */

import { describe, expect, it } from 'vitest';
import { buildGedcomTree } from './node';
import { logicalText } from './evidence-lines';
import { parseGedcom } from './parser';

/** A file joined by `terminator`, so a lone `\r` and a `\r\n` are exercised alike. */
const file = (terminator: string) =>
	[
		'0 HEAD',
		'1 GEDC',
		'2 VERS 5.5.1',
		'0 @I1@ INDI',
		'1 NAME Ann /Ash/',
		'1 NOTE first',
		'second',
		'0 TRLR'
	].join(terminator);

describe('every line terminator splits a file', () => {
	it.each([
		['a lone CR (old Mac)', '\r'],
		['a CRLF', '\r\n'],
		['a LF', '\n']
	])('reads %s and keeps the text after the terminator', (_name, terminator) => {
		const parsed = parseGedcom(file(terminator) + terminator);
		expect(parsed.individuals).toHaveLength(1);
		expect(parsed.individuals[0].notes?.[0]?.text).toBe('first\nsecond');
	});
});

describe('a stray segment is a continuation, not lost', () => {
	it('treats a line whose level is over 99 as text, not a structure', () => {
		const nodes = buildGedcomTree(['0 @I1@ INDI', '1 NOTE a', '99999999999 FOO x']);
		expect(nodes[0].children).toHaveLength(1);
	});

	it('keeps a segment that is not a GEDCOM line as the previous line’s text', () => {
		const nodes = buildGedcomTree(['0 @I1@ INDI', '1 NOTE first', 'second']);
		const note = nodes[0].children.find((c) => c.tag === 'NOTE')!;
		expect(logicalText(note)).toBe('first\nsecond');
	});

	it('keeps several stray segments in order', () => {
		const nodes = buildGedcomTree(['1 NOTE a', 'b', 'c'], 1);
		expect(logicalText(nodes[0])).toBe('a\nb\nc');
	});

	it('keeps a stray segment after a real CONT under the same owner', () => {
		const nodes = buildGedcomTree(['1 NOTE first', '2 CONT second', 'third'], 1);
		expect(logicalText(nodes[0])).toBe('first\nsecond\nthird');
	});
});
