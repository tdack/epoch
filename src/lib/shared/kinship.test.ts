import { describe, expect, it } from 'vitest';
import { routeSentence } from './kinship';

describe('the sentence a route is shown as', () => {
	it.each([
		[{ kind: 'blood', label: '1st cousin' }, "Yan is Xia's 1st cousin."],
		[{ kind: 'partner', label: 'partner' }, "Yan is Xia's partner."],
		[{ kind: 'self', label: 'the same person' }, 'Xia is the same person.'],
		[{ kind: 'by-partnership', label: 'partner of 1st cousin' }, "Yan is the partner of Xia's 1st cousin."],
		[{ kind: 'by-partnership', label: '2nd cousin once removed of partner' }, "Yan is the 2nd cousin once removed of Xia's partner."],
		[{ kind: 'by-partnership', label: 'step-parent' }, "Yan is Xia's step-parent."],
		[{ kind: 'by-partnership', label: 'sibling-in-law' }, "Yan is Xia's sibling-in-law."]
	] as const)('%j', (route, expected) => {
		expect(routeSentence('Xia', 'Yan', route)).toBe(expected);
	});
});
