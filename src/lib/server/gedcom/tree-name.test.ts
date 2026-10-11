/**
 * The name a file carries for its tree. GEDCOM has no tree-name field, so a `HEAD` note beginning
 * `Tree:` (the convention Epoch and its peers write) is read as one; `HEAD.FILE` is kept separately
 * because it names the file, not the tree. A record `NOTE` is never the tree's.
 */

import { describe, expect, it } from 'vitest';
import { parseGedcom } from './parser';

const head = (lines: string[]) =>
	['0 HEAD', '1 GEDC', '2 VERS 5.5.1', ...lines, '0 @I1@ INDI', '1 NAME Ann /Ash/', '0 TRLR'].join(
		'\n'
	);

describe('a Tree: note in the header names the tree', () => {
	it('reads the first line of the first matching header note', () => {
		const parsed = parseGedcom(head(['1 NOTE Tree: The Ash Lineage']));
		expect(parsed.treeName).toBe('The Ash Lineage');
	});

	it('keeps only the first line and caps the name', () => {
		const long = 'x'.repeat(250);
		const parsed = parseGedcom(head([`1 NOTE Tree: ${long}`, '2 CONT and more']));
		expect(parsed.treeName).toHaveLength(200);
		expect(parsed.treeName).toBe('x'.repeat(200));
	});

	it('does not case-fold: a lowercase tag is not the convention', () => {
		expect(parseGedcom(head(['1 NOTE tree: The Ash Lineage'])).treeName).toBeUndefined();
	});

	it('ignores a note that does not begin Tree:', () => {
		expect(parseGedcom(head(['1 NOTE A note about the file'])).treeName).toBeUndefined();
	});

	it('never reads a record note as the tree’s', () => {
		const parsed = parseGedcom(
			[
				'0 HEAD',
				'1 GEDC',
				'2 VERS 5.5.1',
				'0 @I1@ INDI',
				'1 NAME Ann /Ash/',
				'1 NOTE Tree: Not the tree',
				'0 TRLR'
			].join('\n')
		);
		expect(parsed.treeName).toBeUndefined();
	});
});

describe('HEAD.FILE is kept apart from the tree name', () => {
	it('exposes the file name, and does not use it as the tree name', () => {
		const parsed = parseGedcom(head(['1 FILE /home/ann/family.ged']));
		expect(parsed.fileTreeName).toBe('/home/ann/family.ged');
		expect(parsed.treeName).toBeUndefined();
	});
});
