import { describe, expect, it } from 'vitest';
import { isGedcomFileName } from './gedcom-files.js';

describe('isGedcomFileName', () => {
	it('takes GEDCOM and GEDZip names in any case', () => {
		for (const name of ['family.ged', 'Family.GED', 'tree.gedcom', 'export.gdz'])
			expect(isGedcomFileName(name)).toBe(true);
	});

	it('refuses anything else', () => {
		for (const name of ['photo.jpg', 'family.ged.txt', 'ged', 'notes.gedx'])
			expect(isGedcomFileName(name)).toBe(false);
	});
});
