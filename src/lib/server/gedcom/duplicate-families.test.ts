import { describe, expect, it } from 'vitest';
import dirty from '../../../../docs/The_Simpsons.ged?raw';
import clean from '../../../../docs/The_Simpsons_clean.ged?raw';
import {
	detectDuplicateFamilies,
	mergeExactDuplicateFamilies,
	POSSIBLE_DUPLICATE_REASONS
} from './duplicate-families';
import { parseGedcom } from './index';

const fam = (id: string, body: string) => `0 ${id} FAM\n${body}`;
const file = (...families: string[]) =>
	`0 HEAD\n${['I1', 'I2', 'I3', 'I4'].map((i) => `0 @${i}@ INDI\n1 NAME ${i} /T/`).join('\n')}\n${families.join('\n')}\n0 TRLR`;
const couple = '1 HUSB @I1@\n1 WIFE @I2@';
const marriage = (date: string) => `1 MARR\n2 DATE ${date}`;

describe('duplicate families in The_Simpsons.ged (the dirty file)', () => {
	const parsed = parseGedcom(dirty);
	const report = detectDuplicateFamilies(parsed);

	it('finds Homer and Marge’s three copies and Bart and Jessica’s two as exact duplicates', () => {
		// In file order of each group's first record: Bart and Jessica appear before Homer and Marge.
		expect(report.exact.map((g) => [g.survivorId, g.familyIds.length, g.childCount])).toEqual([
			['@F_87948dab@', 2, 0],
			['@F_d9d0076c@', 3, 4]
		]);
		expect(report.exact[1].familyIds).toEqual(['@F_d9d0076c@', '@F_ac5bd259@', '@F_d88ca04a@']);
	});

	it('lists the one-partner copies as possible duplicates, and never as exact', () => {
		const possible = report.possible.map((g) => `${g.reason}:${g.familyIds.join(',')}`);
		expect(possible).toContain(
			`${POSSIBLE_DUPLICATE_REASONS.SAME_SINGLE_PARTNER}:@F_797d559f@,@F_4e0af778@`
		);
		expect(possible).toContain(
			`${POSSIBLE_DUPLICATE_REASONS.SUBSET_OF_FULL_FAMILY}:@F_992151b5@,@F_d9d0076c@`
		);
		expect(possible).toContain(
			`${POSSIBLE_DUPLICATE_REASONS.SUBSET_OF_FULL_FAMILY}:@F_8741ccc0@,@F_d9d0076c@`
		);
		const exactIds = report.exact.flatMap((g) => g.familyIds);
		expect(exactIds).not.toContain('@F_992151b5@');
		expect(exactIds).not.toContain('@F_797d559f@');
	});

	it('merges the exact ones: children combined, marriage kept once, every XREF kept as an alias', () => {
		const { parsed: merged, mergedCount } = mergeExactDuplicateFamilies(parsed);
		expect(mergedCount).toBe(3);
		expect(merged.families).toHaveLength(parsed.families.length - 3);
		const homerMarge = merged.families.find((f) => f.id === '@F_d9d0076c@')!;
		expect(homerMarge.aliases).toEqual(['@F_ac5bd259@', '@F_d88ca04a@']);
		expect(homerMarge.children.map((c) => c.childId)).toEqual([
			'@I_c2773035@',
			'@I_7e044ae1@',
			'@I_36d204ee@',
			'@I_547728f0@'
		]);
		const bartJessica = merged.families.find((f) => f.id === '@F_87948dab@')!;
		expect(bartJessica.aliases).toEqual(['@F_ba9969ea@']);
		expect(bartJessica.events.map((e) => [e.type, e.dateRaw])).toEqual([['MARR', '3 Nov 2014']]);
		// The one-partner copies are untouched.
		expect(merged.families.map((f) => f.id)).toContain('@F_992151b5@');
	});

	it('reports nothing for the clean file', () => {
		expect(detectDuplicateFamilies(parseGedcom(clean))).toEqual({ exact: [], possible: [] });
		expect(mergeExactDuplicateFamilies(parseGedcom(clean)).mergedCount).toBe(0);
	});
});

describe('what counts as exact', () => {
	it('needs identical facts: two different marriage dates are only a possible duplicate', () => {
		const parsed = parseGedcom(
			file(
				fam('@F1@', `${couple}\n${marriage('1975')}`),
				fam('@F2@', `${couple}\n${marriage('1980')}`)
			)
		);
		const report = detectDuplicateFamilies(parsed);
		expect(report.exact).toEqual([]);
		expect(report.possible).toMatchObject([
			{ reason: POSSIBLE_DUPLICATE_REASONS.DIFFERENT_FACTS, familyIds: ['@F1@', '@F2@'] }
		]);
		expect(mergeExactDuplicateFamilies(parsed).mergedCount).toBe(0);
	});

	it('does not treat a marriage on one side only as identical', () => {
		const report = detectDuplicateFamilies(
			parseGedcom(file(fam('@F1@', `${couple}\n${marriage('1975')}`), fam('@F2@', couple)))
		);
		expect(report.exact).toEqual([]);
		expect(report.possible[0].reason).toBe(POSSIBLE_DUPLICATE_REASONS.DIFFERENT_FACTS);
	});

	it('treats the same partners in either order, with the same fact, as exact', () => {
		const report = detectDuplicateFamilies(
			parseGedcom(
				file(
					fam('@F1@', `${couple}\n${marriage('1975')}`),
					fam('@F2@', `1 HUSB @I2@\n1 WIFE @I1@\n${marriage('1975')}`)
				)
			)
		);
		expect(report.exact).toHaveLength(1);
	});

	it('is not exact when the copies record the same child differently', () => {
		const report = detectDuplicateFamilies(
			parseGedcom(
				file(
					fam('@F1@', `${couple}\n1 CHIL @I3@`),
					fam('@F2@', `${couple}\n1 CHIL @I3@\n2 PEDI adopted`)
				)
			)
		);
		expect(report.exact).toEqual([]);
		expect(report.possible[0].reason).toBe(POSSIBLE_DUPLICATE_REASONS.DIFFERENT_CHILD_RECORDS);
	});

	it('never merges one-partner families on their own', () => {
		const parsed = parseGedcom(
			file(fam('@F1@', '1 HUSB @I1@\n1 CHIL @I3@'), fam('@F2@', '1 HUSB @I1@\n1 CHIL @I4@'))
		);
		expect(detectDuplicateFamilies(parsed).exact).toEqual([]);
		expect(mergeExactDuplicateFamilies(parsed).mergedCount).toBe(0);
	});

	it('carries aliases a duplicate already had', () => {
		const merged = mergeExactDuplicateFamilies(
			parseGedcom(
				file(fam('@F1@', `${couple}\n1 REFN X\n2 TYPE epoch-merged-family`), fam('@F2@', couple))
			)
		).parsed;
		expect(merged.families[0].aliases).toEqual(['@X@', '@F2@']);
	});
});
