import { afterEach, describe, expect, it } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import type { FactDto, PersonPageDto } from '#lib/shared/person-page.js';
import PersonFacts from './PersonFacts.svelte';

let component: Record<string, unknown> | null = null;
afterEach(() => {
	if (component) unmount(component);
	component = null;
	document.body.innerHTML = '';
});

/** A fact with no details, as a plain GEDCOM birth; a test sets only what it checks. */
function fact(overrides: Partial<FactDto> = {}): FactDto {
	return {
		id: 'f1',
		type: 'BIRT',
		label: 'Birth',
		kind: 'event',
		dateText: '1900',
		sortStart: '1900-01-01',
		sortEnd: '1900-12-31',
		isApproximate: false,
		place: null,
		value: null,
		cause: null,
		age: null,
		address: null,
		classification: null,
		agency: null,
		phone: null,
		email: null,
		fax: null,
		web: null,
		latitude: null,
		longitude: null,
		religion: null,
		retainedLines: [],
		notes: null,
		isLegacyNote: false,
		sortOrder: 0,
		version: 1,
		conflict: null,
		citationCount: 0,
		noteItems: [],
		...overrides
	} as unknown as FactDto;
}

function render(
	facts: FactDto[],
	options: {
		mode?: 'grouped' | 'timeline' | 'attributes';
		partnerships?: PersonPageDto['partnerships'];
		role?: 'viewer' | 'editor';
	} = {}
) {
	const dto = {
		person: { id: 'p1' },
		facts,
		partnerships: options.partnerships ?? [],
		evidence: { citations: [] }
	} as unknown as PersonPageDto;
	component = mount(PersonFacts, {
		target: document.body,
		props: {
			dto,
			treeId: 't1',
			role: options.role ?? 'viewer',
			editor: {} as never,
			toasts: {} as never,
			mode: options.mode
		}
	});
	flushSync();
}

const byTestId = (id: string) => document.querySelector(`[data-testid="${id}"]`);

describe('PersonFacts', () => {
	it('shows no detail lines for a fact that has none', () => {
		render([fact()]);
		for (const id of [
			'fact-address',
			'fact-agency',
			'fact-religion',
			'fact-contact',
			'fact-coordinates',
			'fact-retained'
		]) {
			expect(byTestId(id), id).toBeNull();
		}
	});

	it('shows the address, agency, religion, contacts and coordinates when set', () => {
		render([
			fact({
				address: '12 High St\nYork',
				agency: 'Parish of St Mary',
				religion: 'Anglican',
				phone: '0113 000\n0113 111',
				latitude: 'N53.8',
				longitude: 'W1.5'
			})
		]);
		expect(byTestId('fact-address')!.textContent!.trim()).toBe('12 High St\nYork');
		// Line breaks must show as written; jsdom loads no stylesheet, so check the class that does it.
		expect(byTestId('fact-address')!.classList).toContain('whitespace-pre-line');
		expect(byTestId('fact-agency')!.textContent).toContain('Agency: Parish of St Mary');
		expect(byTestId('fact-religion')!.textContent).toContain('Religion: Anglican');
		const phones = byTestId('fact-contact')!.querySelectorAll('li');
		expect([...phones].map((li) => li.textContent!.trim())).toEqual([
			'Phone: 0113 000',
			'Phone: 0113 111'
		]);
		expect(byTestId('fact-coordinates')!.textContent).toContain('N53.8, W1.5');
	});

	it('links an email and a website only when the value is one the browser may follow', () => {
		render([
			fact({ email: 'parish@example.test', web: 'https://example.test/parish' }),
			// Older, so the newest of the group is the valid one and the hostile one sits behind "Show earlier".
			fact({ id: 'f2', web: 'javascript:alert(1)', sortStart: '1800-01-01' })
		]);
		const [valid, hostile] = [...document.querySelectorAll('[data-testid="fact-contact"]')];
		const email = valid!.querySelector('a[href^="mailto:"]');
		expect(email?.getAttribute('href')).toBe('mailto:parish@example.test');
		const web = valid!.querySelector('a[href^="https://"]');
		expect(web?.getAttribute('href')).toBe('https://example.test/parish');
		expect(web?.getAttribute('rel')).toBe('noopener noreferrer');
		expect(hostile!.querySelector('a')).toBeNull();
		expect(hostile!.textContent).toContain('Website: javascript:alert(1)');
	});

	it('lists retained lines read-only under a disclosure with the explanation', () => {
		render([fact({ retainedLines: ['2 RESN locked', '2 _CUSTOM @N1@'] })]);
		const retained = byTestId('fact-retained') as HTMLDetailsElement;
		expect(retained.tagName).toBe('DETAILS');
		expect(retained.querySelector('summary')!.textContent).toContain(
			'Imported, not editable here (2)'
		);
		expect(retained.textContent).toContain(
			'Kept so your file exports unchanged. The app cannot show or edit these yet.'
		);
		expect(retained.querySelector('pre')!.textContent).toBe('2 RESN locked\n2 _CUSTOM @N1@');
	});

	it('shows the sub-type after the heading of an other event', () => {
		render([fact({ type: 'EVEN', label: 'Other event', classification: 'Anniversary' })]);
		expect(groupHeading(0)).toBe('Other event (Anniversary)');
	});

	it('shows the sub-type of any fact that has one, unless it repeats the label', () => {
		render([
			fact({ id: 'o1', type: 'OCCU', label: 'Occupation', classification: 'Apprentice' }),
			fact({ id: 'r1', type: 'RESI', label: 'Residence', classification: 'residence' })
		]);
		// The heading names the kind, so a sub-typed fact still groups with its kind; the row names the sub-type.
		expect(groupHeading(0)).toBe('Occupation');
		expect(groups()[0]!.textContent).toContain('Apprentice');
		expect(groupHeading(1)).toBe('Residence');
		expect(groups()[1]!.textContent).not.toContain('residence');
	});

	it('groups facts of one kind under one panel, in order of first appearance', () => {
		render([
			fact({ id: 'r1', type: 'RESI', label: 'Residence', sortStart: '1900-01-01' }),
			fact({ id: 'b1', type: 'BIRT', label: 'Birth', sortStart: '1880-01-01' }),
			fact({ id: 'r2', type: 'RESI', label: 'Residence', sortStart: '1910-01-01' })
		]);
		expect(groupCount()).toBe(2);
		expect(groupHeading(0)).toBe('Residence');
		expect(groups()[0]!.querySelector('h4 span')!.textContent).toBe('2');
		expect(groupHeading(1)).toBe('Birth');
	});

	it('groups custom events by their sub-type, so different ones do not merge', () => {
		render([
			fact({ id: 'e1', type: 'EVEN', label: 'Other event', classification: 'Anniversary' }),
			fact({ id: 'e2', type: 'EVEN', label: 'Other event', classification: 'Graduation' })
		]);
		expect(groupCount()).toBe(2);
	});

	it('shows only the newest fact of a group, with the earlier ones behind a button', () => {
		render([
			fact({ id: 'r1', type: 'RESI', label: 'Residence', sortStart: '1900-01-01' }),
			fact({ id: 'r2', type: 'RESI', label: 'Residence', sortStart: '1920-01-01' }),
			fact({ id: 'r3', type: 'RESI', label: 'Residence', sortStart: '1910-01-01' })
		]);
		expect(visibleFactIds()).toEqual(['r2']);
		const toggle = groupButton(0)!;
		expect(toggle.textContent).toBe('Show 2 earlier');
		expect(toggle.getAttribute('aria-expanded')).toBe('false');
		expect(toggle.getAttribute('aria-controls')).toBeTruthy();
	});

	it('reveals the earlier facts newest first, and hides them again', () => {
		render([
			fact({ id: 'r1', type: 'RESI', label: 'Residence', sortStart: '1900-01-01' }),
			fact({ id: 'r2', type: 'RESI', label: 'Residence', sortStart: '1920-01-01' }),
			fact({ id: 'r3', type: 'RESI', label: 'Residence', sortStart: '1910-01-01' })
		]);
		const toggle = groupButton(0)!;
		toggle.click();
		flushSync();
		expect(visibleFactIds()).toEqual(['r2', 'r3', 'r1']);
		expect(toggle.textContent).toBe('Hide earlier');
		expect(toggle.getAttribute('aria-expanded')).toBe('true');
		toggle.click();
		flushSync();
		expect(visibleFactIds()).toEqual(['r2']);
	});

	it('counts an undated fact as the oldest, and ties go to the later one in the list', () => {
		render([
			fact({ id: 'undated', type: 'RESI', label: 'Residence', dateText: null, sortStart: null }),
			fact({ id: 'first', type: 'RESI', label: 'Residence', sortStart: '1900-01-01' }),
			fact({ id: 'second', type: 'RESI', label: 'Residence', sortStart: '1900-01-01' })
		]);
		expect(visibleFactIds()).toEqual(['second']);
	});

	it('shows every fact of a group that has a conflict, with no button to hide them', () => {
		render([
			fact({ id: 'b1', type: 'BIRT', sortStart: '1900-01-01' }),
			fact({
				id: 'b2',
				type: 'BIRT',
				sortStart: '1901-01-01',
				conflict: { kind: 'conflict', otherIds: ['b1'] } as never
			})
		]);
		expect(visibleFactIds()).toEqual(['b2', 'b1']);
		expect(groupButton(0)).toBeNull();
		expect(byTestId('fact')!.getAttribute('data-conflict')).toBe('conflict');
	});
});

describe('PersonFacts as a timeline', () => {
	const marriage = (dateSort: string | null, dateText: string | null, children: unknown[] = []) =>
		[
			{
				unionId: 'u1',
				partners: [{ id: 'p2', displayName: 'Myrtle Blishen' }],
				children,
				events: [{ id: 'm1', type: 'MARR', dateText, dateSort, place: 'Kurri Kurri' }]
			}
		] as unknown as PersonPageDto['partnerships'];

	it('lists a child’s birth in its place, with the person’s age then and the child linked', () => {
		const child = {
			person: {
				id: 'c1',
				displayName: 'Jean Blishen',
				sex: 'F',
				birthDate: '12 MAY 1937',
				birthSort: '1937-05-12',
				isPrivate: false
			},
			types: ['biological']
		};
		render(
			[
				fact({
					id: 'birth',
					sortStart: '1910-08-05',
					sortEnd: '1910-08-05',
					dateText: '05 AUG 1910'
				}),
				fact({ id: 'death', type: 'DEAT', label: 'Death', sortStart: '1970-04-03' })
			],
			{ mode: 'timeline', partnerships: marriage('1935-04-06', '06 APR 1935', [child]) }
		);
		const rows = [...document.querySelectorAll('[data-testid="facts"] > li')];
		expect(rows.map((row) => row.querySelector('h4')!.textContent!.trim())).toEqual([
			'Birth',
			'Marriage',
			'Birth of daughter',
			'Death'
		]);
		const birth = byTestId('life-child-birth')!;
		expect(birth.querySelector('[aria-hidden]')!.textContent).toBe(' · aged 26');
		expect(birth.querySelector('a[href$="/people/c1"]')!.textContent).toContain('Jean Blishen');
		// The marriage gets an age too, from its date text.
		expect(byTestId('life-union-event')!.querySelector('[aria-hidden]')!.textContent).toBe(
			' · aged 24'
		);
	});

	it('reads oldest first, with the marriage in its place and the partner named', () => {
		render(
			[
				fact({ id: 'birth', sortStart: '1910-08-05', dateText: '05 AUG 1910' }),
				fact({ id: 'death', type: 'DEAT', label: 'Death', sortStart: '1970-04-03' })
			],
			{ mode: 'timeline', partnerships: marriage('1935-04-06', '06 APR 1935') }
		);
		const rows = [...document.querySelectorAll('[data-testid="facts"] > li')];
		expect(rows.map((row) => row.querySelector('h4')!.textContent!.trim())).toEqual([
			'Birth',
			'Marriage',
			'Death'
		]);
		const union = byTestId('life-union-event')!;
		expect(union.textContent).toContain('6 April 1935 · with Myrtle Blishen');
		expect(union.querySelector('a[href$="/people/p2"]')).not.toBeNull();
		// A viewer may follow the partnership but not edit it.
		expect(union.querySelector('button')).toBeNull();
	});

	it('gives the age at each event from the birth, and none where the record states one', () => {
		const day = (id: string, type: string, label: string, sort: string, dateText: string) =>
			fact({ id, type, label, sortStart: sort, sortEnd: sort, dateText });
		render(
			[
				day('birth', 'BIRT', 'Birth', '1910-08-05', '05 AUG 1910'),
				day('cens', 'CENS', 'Census', '1921-04-03', '03 APR 1921'),
				day('chr', 'CHR', 'Christening', '1910-09-01', '01 SEP 1910'),
				day('buri', 'BURI', 'Burial', '1970-04-10', '10 APR 1970'),
				fact({
					id: 'grad',
					type: 'GRAD',
					label: 'Graduation',
					dateText: '1931',
					sortStart: '1931-01-01',
					sortEnd: '1931-12-31'
				}),
				{ ...day('death', 'DEAT', 'Death', '1970-04-03', '03 APR 1970'), age: '59' }
			],
			{ mode: 'timeline' }
		);
		const ages = [...document.querySelectorAll('[data-testid="fact-age"]')];
		// The graduation's year only, so it could be either side of the birthday. A burial has none,
		// so it cannot contradict the death's, and nor has a christening (nearly always under 1).
		expect(ages.map((a) => a.querySelector('[aria-hidden]')!.textContent!.trim())).toEqual([
			'· aged 10',
			'· aged 20–21'
		]);
		expect(ages[1]!.querySelector('.sr-only')!.textContent).toBe(
			', aged 20 to 21, calculated from the birth date'
		);
	});

	it('shows every event, so a conflict sits in place and nothing is behind a button', () => {
		render(
			[
				fact({ id: 'b1', sortStart: '1900-01-01' }),
				fact({
					id: 'b2',
					sortStart: '1901-01-01',
					conflict: { kind: 'conflict', otherIds: ['b1'] } as never
				})
			],
			{ mode: 'timeline' }
		);
		expect(visibleFactIds()).toEqual(['b1', 'b2']);
		expect(document.querySelector('button[aria-controls]')).toBeNull();
		expect(byTestId('fact-group')).toBeNull();
	});

	it('leaves the attributes to their own list', () => {
		render([fact({ id: 'b1' }), residence('r1', null)], { mode: 'timeline' });
		expect(visibleFactIds()).toEqual(['b1']);
		expect(byTestId('attributes')).toBeNull();
	});

	it('moves a same-date event up toward the earlier end', () => {
		render(
			[
				fact({ id: 'b1', type: 'BAPM', label: 'Baptism' }),
				fact({ id: 'c1', type: 'CHR', label: 'Christening' })
			],
			{ mode: 'timeline', role: 'editor' }
		);
		const label = (b: Element) => b.getAttribute('aria-label');
		const moves = [...document.querySelectorAll('button[aria-label^="Move"]')].map(label);
		expect(moves).toEqual(['Move Baptism down', 'Move Christening up']);
	});
});

describe('PersonFacts as the page’s attributes', () => {
	it('shows one row per kind with its newest, and no "Date unknown" on an undated one', () => {
		render(
			[
				fact({ id: 'b1' }),
				residence('r1', '1900-01-01'),
				fact({
					id: 'o1',
					type: 'OCCU',
					label: 'Occupation',
					kind: 'attribute',
					value: 'Joiner',
					dateText: null,
					sortStart: null
				}),
				residence('r2', '1920-01-01')
			],
			{ mode: 'attributes' }
		);
		expect(groupCount()).toBe(2);
		expect([groupHeading(0), groupHeading(1)]).toEqual(['Residence', 'Occupation']);
		expect(visibleFactIds()).toEqual(['r2', 'o1']);
		expect(byTestId('attributes')!.textContent).not.toContain('Date unknown');
	});

	it('reveals the earlier ones newest first behind a button', () => {
		render(
			[residence('r1', '1900-01-01'), residence('r2', '1920-01-01'), residence('r3', '1910-01-01')],
			{
				mode: 'attributes'
			}
		);
		const toggle = groupButton(0)!;
		expect(toggle.textContent!.trim()).toBe('Show 2 earlier');
		toggle.click();
		flushSync();
		expect(visibleFactIds()).toEqual(['r2', 'r3', 'r1']);
		expect(toggle.getAttribute('aria-expanded')).toBe('true');
	});

	it('never folds a group with a conflict', () => {
		render(
			[
				residence('r1', '1900-01-01'),
				residence('r2', '1920-01-01', { conflict: { kind: 'repeat', otherIds: ['r1'] } as never })
			],
			{ mode: 'attributes' }
		);
		expect(visibleFactIds()).toEqual(['r2', 'r1']);
		expect(groupButton(0)).toBeNull();
	});

	it('moves a same-date attribute only within its kind, up toward the newer end', () => {
		render(
			[
				residence('r1', null),
				residence('r2', null),
				fact({ id: 'o1', type: 'OCCU', label: 'Occupation', kind: 'attribute', sortStart: null })
			],
			{ mode: 'attributes', role: 'editor' }
		);
		const ids = (selector: string) =>
			[...document.querySelectorAll(selector)].map((b) =>
				b.closest('[data-fact-id]')!.getAttribute('data-fact-id')
			);
		expect(ids('button[aria-label="Move Residence up"]')).toEqual(['r1']);
		expect(ids('button[aria-label="Move Residence down"]')).toEqual(['r2']);
		expect(document.querySelector('button[aria-label^="Move Occupation"]')).toBeNull();
		// Adding a fact is the Life section's job; the attributes list draws no second button.
		expect(document.body.textContent).not.toContain('Add fact');
	});
});

function residence(
	id: string,
	sortStart: string | null,
	overrides: Partial<FactDto> = {}
): FactDto {
	return fact({
		id,
		type: 'RESI',
		label: 'Residence',
		kind: 'attribute',
		value: id,
		dateText: sortStart,
		sortStart,
		...overrides
	});
}

/** The panel headings, as the reader sees them: a label and, for more than one fact, its count. */
const groups = () => [...document.querySelectorAll('[data-testid="fact-group"]')];
const groupCount = () => groups().length;
/** The label alone; the count is a separate span after it. */
const groupHeading = (index: number) =>
	groups()[index]!.querySelector('h4')!.childNodes[0]!.textContent!.trim();
const groupButton = (index: number) =>
	groups()[index]!.querySelector('button[aria-controls]') as HTMLButtonElement | null;

/** The fact rows a reader can see, in order: rows inside a hidden list are skipped. */
function visibleFactIds(): string[] {
	return [...document.querySelectorAll<HTMLElement>('[data-testid="fact"]')]
		.filter((row) => !row.closest('[hidden]'))
		.map((row) => row.getAttribute('data-fact-id') ?? '');
}
