import { describe, expect, it } from 'vitest';
import factDetails from '../../../../test/data/fact-details.ged?raw';
import { parseGedcom } from './parser';

const eventsOf = (xref: string) => {
	const parsed = parseGedcom(factDetails);
	const individual = [...parsed.individuals, ...parsed.families].find((x) => x.id === xref);
	return individual!.events;
};

const byType = (events: ReturnType<typeof eventsOf>, type: string) => {
	const found = events.filter((e) => e.type === type);
	expect(found).toHaveLength(1);
	return found[0]!;
};

describe('fact details read from an event', () => {
	const ada = eventsOf('@I1@');

	it('reads an address with CONT and sub-lines, keeping the layout the file wrote', () => {
		const birth = byType(ada, 'BIRT');
		expect(birth.address).toBe('12 Curzon Street\nMayfair');
		expect(birth.addressLayout).toEqual([
			'2 ADDR 12 Curzon Street',
			'3 CONT Mayfair',
			'3 CITY London',
			'3 POST W1J 7AB'
		]);
	});

	it('joins a CONC without a separator, and keeps the address untrimmed', () => {
		expect(byType(ada, 'DEAT').address).toBe('3 Grosvenor Place');
	});

	it('reads each contact tag, one value per line in file order', () => {
		const birth = byType(ada, 'BIRT');
		expect(birth.phone).toBe('020 7946 0000\n020 7946 0001');
		expect(birth.fax).toBe('020 7946 0002');
		expect(birth.email).toBe('ada@@example.org');
		expect(birth.web).toBe('https://example.org/ada');
	});

	it('reads the agency and religion, and the TYPE of an EVEN', () => {
		const birth = byType(ada, 'BIRT');
		expect(birth.agency).toBe('Parish of St George');
		expect(birth.religion).toBe('Church of England');
		expect(byType(ada, 'EVEN').classification).toBe('Military');
	});

	it('reads the first MAP as coordinates, exactly as written, and keeps a second MAP and FORM', () => {
		const birth = byType(ada, 'BIRT');
		expect(birth.latitude).toBe('N51.510000');
		expect(birth.longitude).toBe('W0.150000');
		expect(birth.placeExtra).toEqual([
			'3 FORM City, Borough, Country',
			'3 MAP',
			'4 LATI N1.000000',
			'4 LONG E1.000000'
		]);
		expect(birth.place).toBe('Mayfair, London, England');
	});

	it('keeps a place with no text but with sub-lines whole in the extra lines', () => {
		const death = byType(ada, 'DEAT');
		expect(death.place).toBeUndefined();
		expect(death.placeExtra).toBeUndefined();
		expect(death.extra).toContain('3 FORM Unknown');
		expect(death.extra).toContain('2 PLAC');
	});

	it('keeps a repeated or structured line in the extra lines', () => {
		const death = byType(ada, 'DEAT');
		expect(death.extra).toEqual(['2 PLAC', '3 FORM Unknown', '2 RESN privacy']);
		expect(byType(ada, 'EVEN').extra).toEqual(['2 PHON 0800 000 111', '3 TYPE Mobile']);
		expect(byType(ada, 'EVEN').phone).toBeUndefined();
	});

	it('reads the same details on a family event', () => {
		const marriage = byType(eventsOf('@F1@'), 'MARR');
		expect(marriage.address).toBe('Church Street');
		expect(marriage.agency).toBe('Registry Office');
		expect(marriage.phone).toBe('01335 000 000');
		expect(marriage.latitude).toBe('N53.000000');
		expect(marriage.extra).toBeUndefined();
	});
});

describe('reading an event the way it was read before fact details were modelled', () => {
	it('leaves every detail in the extra lines and drops the place sub-lines', () => {
		const parsed = parseGedcom(factDetails, { areFactDetailsModelled: false });
		const birth = parsed.individuals[0]!.events.find((e) => e.type === 'BIRT')!;
		expect(birth.address).toBeUndefined();
		expect(birth.phone).toBeUndefined();
		expect(birth.latitude).toBeUndefined();
		expect(birth.placeExtra).toBeUndefined();
		expect(birth.extra).toEqual(
			expect.arrayContaining([
				'2 ADDR 12 Curzon Street',
				'3 CONT Mayfair',
				'2 PHON 020 7946 0000',
				'2 AGNC Parish of St George',
				'2 RELI Church of England'
			])
		);
		expect(birth.extra?.some((line) => line.includes('FORM') || line.includes('MAP'))).toBe(false);
	});
});
