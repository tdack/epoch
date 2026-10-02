import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import type { PersonPageDto, PersonSummaryDto } from '#lib/server/services/person-page-service.js';
import PersonDrawer from './PersonDrawer.svelte';

let component: Record<string, unknown> | null = null;
afterEach(() => {
	if (component) unmount(component);
	component = null;
	document.body.innerHTML = '';
});

const summary = (id: string, displayName: string): PersonSummaryDto => ({
	id,
	displayName,
	sex: 'U',
	birthDate: null,
	deathDate: null,
	isDeceased: false,
	isPrivate: false
});

/** Only what the drawer reads; the rest of the DTO is irrelevant to it. */
function pageOf(
	id: string,
	name: string,
	extra: Partial<PersonPageDto> = {},
	sex: PersonPageDto['person']['sex'] | undefined = 'U'
): PersonPageDto {
	return {
		isPrivate: false,
		person: {
			id,
			displayName: name,
			sex: sex as PersonPageDto['person']['sex'],
			xrefId: null,
			version: 1,
			givenName: name,
			surname: null,
			isDeceased: false
		},
		vitals: { birth: null, death: null, lifespan: null, hasConflict: false },
		facts: [],
		parentFamilies: [],
		partnerships: [],
		directChildren: [],
		siblings: { full: [], half: [] },
		stepParents: [],
		stepChildren: [],
		media: [],
		...extra
	} as unknown as PersonPageDto;
}

function open(page: PersonPageDto) {
	const onSelectPerson = vi.fn();
	component = mount(PersonDrawer, {
		target: document.body,
		props: { page, treeId: 't', onClose: vi.fn(), onSelectPerson }
	});
	flushSync();
	return { onSelectPerson };
}

const steps = () => document.querySelector('[data-testid="step-relatives"]');

describe('PersonDrawer step relatives', () => {
	it('lists a step-parent apart from parents and children', () => {
		open(pageOf('cal', 'Cal', { stepParents: [{ person: summary('dee', 'Dee'), unionId: 'u2' }] }));
		expect(steps()!.textContent).toContain('Dee');
		expect(steps()!.textContent).toContain('(step-parent)');
	});

	it('lists the partner’s child as a step-child, and selecting one navigates', () => {
		const { onSelectPerson } = open(
			pageOf('dee', 'Dee', {
				stepChildren: [{ person: summary('cal', 'Cal'), via: summary('ann', 'Ann'), unionId: 'u1' }]
			})
		);
		expect(steps()!.textContent).toContain('step-child, via Ann');
		steps()!.querySelector('button')!.click();
		expect(onSelectPerson).toHaveBeenCalledWith('cal');
	});

	it('shows no step section for someone with none', () => {
		open(pageOf('ben', 'Ben'));
		expect(steps()).toBeNull();
	});
});

describe('PersonDrawer', () => {
	it.each([
		['M', 'Male'],
		['F', 'Female'],
		['X', 'Other'],
		['U', 'Unknown'],
		[undefined, 'Unknown']
	])('labels sex %s as %s', (sex, label) => {
		open(pageOf('ben', 'Ben', {}, sex as PersonPageDto['person']['sex'] | undefined));
		expect(document.body.textContent).toContain(`Sex: ${label}`);
	});

	it('links to the full page and marks a fact that disagrees with another', () => {
		open(
			pageOf('ben', 'Ben', {
				facts: [
					{
						id: 'b1',
						label: 'Birth',
						dateText: '1900',
						place: null,
						value: null,
						notes: null,
						conflict: { kind: 'conflict', otherIds: ['b2'] }
					} as never
				]
			})
		);
		expect(document.querySelector('a[href="/trees/t/people/ben"]')).not.toBeNull();
		expect(document.body.textContent).toContain('Disagrees with another recorded birth');
	});

	it('lists siblings with half-siblings marked', () => {
		open(
			pageOf('cat', 'Cat', {
				siblings: { full: [summary('dan', 'Dan')], half: [summary('fay', 'Fay')] }
			})
		);
		const text = document.querySelector('[data-testid="siblings"]')!.textContent!;
		expect(text).toContain('Dan');
		expect(text).toContain('Fay');
		expect(text).toContain('(half-sibling)');
	});
});

describe('PersonDrawer header', () => {
	const initialsOf = (given: string | null, surname: string | null, displayName: string) => {
		const page = pageOf('p', displayName);
		page.person.givenName = given;
		page.person.surname = surname;
		open(page);
		return document.querySelector('span.uppercase')!.textContent;
	};

	it('uses the first given name and the surname for the initials', () => {
		expect(initialsOf('Jessica Louise', 'Simpson', 'Jessica Louise Lovejoy')).toBe('SL');
	});

	it('falls back to the first and last words of the display name', () => {
		expect(initialsOf(null, null, 'Ada Byron King')).toBe('AK');
	});

	it('shows one letter for a single name', () => {
		expect(initialsOf('Cher', null, 'Cher')).toBe('C');
	});

	it('has no relationship button in the header block', () => {
		open(pageOf('p', 'Pat'));
		expect(
			[...document.querySelectorAll('button')].some((b) => b.textContent?.trim() === 'Relationship')
		).toBe(false);
	});
});
