import { describe, expect, it } from 'vitest';
import { formatGedcomDiff, semanticDiff } from './semantic-diff';

const HEAD = '0 HEAD\n1 GEDC\n2 VERS 7.0\n';
const file = (body: string, head = HEAD) => `${head}${body}0 TRLR\n`;

describe('semanticDiff', () => {
	it('ignores xref text, record order, line terminators and a BOM', () => {
		const a = file(
			'0 @I1@ INDI\n1 NAME Ann /Ash/\n1 FAMS @F1@\n0 @I2@ INDI\n1 NAME Bo /Ash/\n1 FAMS @F1@\n0 @F1@ FAM\n1 HUSB @I2@\n1 WIFE @I1@\n'
		);
		const b = `\uFEFF${file(
			'0 @F9@ FAM\n1 WIFE @A@\n1 HUSB @B@\n0 @B@ INDI\n1 FAMS @F9@\n1 NAME Bo /Ash/\n0 @A@ INDI\n1 FAMS @F9@\n1 NAME Ann /Ash/\n'
		)}`.replace(/\n/g, '\r\n');
		expect(formatGedcomDiff(semanticDiff(a, b))).toBe('');
	});

	it('treats CONT as one line, @@ as @, and drops CHAN and extra HEAD lines', () => {
		const a = file('0 @I1@ INDI\n1 NOTE a\n2 CONT @@b\n1 CHAN\n2 DATE 1 JAN 2000\n');
		const b = file('0 @I1@ INDI\n1 NOTE a\n2 CONT @b\n', `${HEAD}1 SOUR X\n1 NOTE tree\n`);
		expect(semanticDiff(a, b).isEmpty).toBe(true);
	});

	it('keeps the order of NAME and CHIL but not of events', () => {
		const people = '0 @I1@ INDI\n1 NAME A /X/\n1 NAME B /Y/\n';
		expect(
			semanticDiff(file(people), file('0 @I1@ INDI\n1 NAME B /Y/\n1 NAME A /X/\n')).isEmpty
		).toBe(false);
		const events = (order: string[]) =>
			file(`0 @I1@ INDI\n${order.map((t) => `1 ${t}\n2 DATE 1900\n`).join('')}`);
		expect(semanticDiff(events(['BIRT', 'DEAT']), events(['DEAT', 'BIRT'])).isEmpty).toBe(true);
	});

	it('reports missing, added and changed substructures with their path', () => {
		const a = file('0 @I1@ INDI\n1 NAME Ann /Ash/\n1 BIRT\n2 DATE 1900\n2 PLAC Hull\n1 SEX F\n');
		const b = file('0 @I1@ INDI\n1 NAME Ann /Ash/\n1 BIRT\n2 DATE ABT 1900\n1 DEAT\n2 DATE 1950\n');
		const diff = semanticDiff(a, b);
		expect(diff.changes.map((c) => `${c.kind} ${c.path}`).sort()).toEqual([
			'added INDI.DEAT',
			'changed INDI.BIRT.DATE',
			'missing INDI.BIRT.PLAC',
			'missing INDI.SEX'
		]);
	});

	it('reports a whole record that is gone and one that appeared', () => {
		const a = file('0 @I1@ INDI\n1 NAME Ann /Ash/\n0 @S1@ SOUR\n1 TITL Book\n');
		const b = file('0 @I1@ INDI\n1 NAME Ann /Ash/\n0 @N1@ SNOTE text\n');
		const diff = semanticDiff(a, b);
		expect(diff.recordsMissing).toEqual(['SOUR @S1@ (Book)']);
		expect(diff.recordsAdded).toEqual(['SNOTE @N1@']);
	});

	it('compares pointers by the record they reach, not by text', () => {
		const a = file(
			'0 @I1@ INDI\n1 NAME A /X/\n1 FAMC @F1@\n0 @I2@ INDI\n1 NAME B /Y/\n0 @F1@ FAM\n1 CHIL @I1@\n1 HUSB @I2@\n'
		);
		const wrong = file(
			'0 @I1@ INDI\n1 NAME A /X/\n1 FAMC @F1@\n0 @I2@ INDI\n1 NAME B /Y/\n0 @F1@ FAM\n1 CHIL @I2@\n1 HUSB @I2@\n'
		);
		expect(semanticDiff(a, wrong).isEmpty).toBe(false);
	});

	it('ignores a SUBM record only the export has', () => {
		const a = file('0 @I1@ INDI\n1 NAME A /X/\n');
		expect(semanticDiff(a, file('0 @I1@ INDI\n1 NAME A /X/\n0 @U@ SUBM\n1 NAME T\n')).isEmpty).toBe(
			true
		);
	});

	it('matches by UID before content', () => {
		const a = file('0 @I1@ INDI\n1 NAME Ann /Ash/\n1 UID 1\n');
		const b = file('0 @I1@ INDI\n1 NAME Anne /Ash/\n1 UID 1\n');
		const diff = semanticDiff(a, b);
		expect(diff.recordsMissing).toEqual([]);
		expect(diff.changes.map((c) => c.kind)).toEqual(['changed']);
	});
});
