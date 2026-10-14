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

function render(facts: FactDto[]) {
	const dto = {
		person: { id: 'p1' },
		facts,
		evidence: { citations: [] }
	} as unknown as PersonPageDto;
	component = mount(PersonFacts, {
		target: document.body,
		props: {
			dto,
			treeId: 't1',
			role: 'viewer',
			editor: {} as never,
			toasts: {} as never
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
			fact({ id: 'f2', web: 'javascript:alert(1)' })
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
		expect(document.querySelector('[data-testid="fact"] span')!.textContent).toContain(
			'Other event (Anniversary)'
		);
	});
});
