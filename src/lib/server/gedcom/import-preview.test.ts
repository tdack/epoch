import { describe, expect, it } from 'vitest';
import factDetails from '../../../../test/data/fact-details.ged?raw';
import windsors from '../../../../test/data/The Windsors.ged?raw';
import { previewAgainstTree, previewNewTree } from './import-preview';
import { parseGedcom } from './parser';

/** A file with one individual and no events, so the header is the only other structure. */
function fileWithEvents(eventLines: string[], familyLines: string[] = []): string {
	return [
		'0 HEAD',
		'1 GEDC',
		'2 VERS 5.5.1',
		'0 @I1@ INDI',
		'1 NAME Ada /Lovelace/',
		...eventLines,
		'0 @F1@ FAM',
		'1 HUSB @I1@',
		...familyLines,
		'0 TRLR'
	].join('\n');
}

describe('retained tags in the import preview', () => {
	it('counts what a file keeps under events, and nothing it models', () => {
		const preview = previewNewTree(parseGedcom(factDetails));
		// The EVEN's PHON keeps its TYPE child, so the line stays whole; the DEAT's PLAC has no
		// value but a FORM child, so it stays whole too. The modelled ADDR, PHON, EMAIL, FAX, WWW,
		// AGNC, RELI and CAUS are not counted.
		expect(preview.retainedTags).toEqual([
			{ tag: 'PHON', count: 1 },
			{ tag: 'PLAC', count: 1 },
			{ tag: 'RESN', count: 1 }
		]);
	});

	it('shows what remains of the Windsors file: objects and associations only', () => {
		const preview = previewNewTree(parseGedcom(windsors));
		expect(preview.retainedTags).toEqual([
			{ tag: 'OBJE', count: 50 },
			{ tag: 'ASSO', count: 6 }
		]);
	});

	it('counts a second TYPE or ADDR under one event, which has no column', () => {
		const file = fileWithEvents([
			'1 BIRT',
			'2 DATE 1900',
			'2 ADDR 1 Road',
			'2 TYPE first',
			'2 TYPE second',
			'2 ADDR 2 Road'
		]);
		expect(previewNewTree(parseGedcom(file)).retainedTags).toEqual([
			{ tag: 'ADDR', count: 1 },
			{ tag: 'TYPE', count: 1 }
		]);
	});

	it('sorts by count, then tag, across individual and family events', () => {
		const file = fileWithEvents(
			[
				'1 BIRT',
				'2 RESN privacy',
				'2 _CUSTOM a',
				'2 _CUSTOM b',
				'2 _CUSTOM c',
				'2 OBJE @M1@',
				'1 DEAT',
				'2 RESN locked',
				'2 _CUSTOM d'
			],
			['1 MARR', '2 RESN confidential', '2 _CUSTOM e']
		);
		expect(previewNewTree(parseGedcom(file)).retainedTags).toEqual([
			{ tag: '_CUSTOM', count: 5 },
			{ tag: 'RESN', count: 3 },
			{ tag: 'OBJE', count: 1 }
		]);
	});

	it('lists at most twenty tags', () => {
		const eventLines = ['1 BIRT'];
		for (let i = 0; i < 25; i++) eventLines.push(`2 _T${String(i).padStart(2, '0')} x`);
		const retained = previewNewTree(parseGedcom(fileWithEvents(eventLines))).retainedTags;
		expect(retained).toHaveLength(20);
		expect(retained[0]).toEqual({ tag: '_T00', count: 1 });
	});

	it('counts the same way for an existing tree, from the file as written', () => {
		const file = fileWithEvents(['1 BIRT', '2 RESN privacy'], ['1 MARR', '2 RESN confidential']);
		const fresh = parseGedcom(file);
		const preview = previewAgainstTree('tree-1', fresh, fresh, {
			individuals: [],
			unions: [],
			parentChild: [],
			events: []
		});
		expect(preview.retainedTags).toEqual([{ tag: 'RESN', count: 2 }]);
	});

	it('is empty when nothing is kept', () => {
		const file = fileWithEvents(['1 BIRT', '2 DATE 1900', '2 ADDR Road', '2 PHON 123']);
		expect(previewNewTree(parseGedcom(file)).retainedTags).toEqual([]);
	});
});
