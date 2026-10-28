import { afterEach, expect, it } from 'vitest';
import { mount, unmount } from 'svelte';
import Page from './+page.svelte';

let component: Record<string, unknown> | null = null;
afterEach(() => {
	if (component) unmount(component);
	component = null;
	document.body.innerHTML = '';
});

const person = { id: 'a', name: 'Ann Fox', isPrivate: false, birth: null, death: null };
const entry = (
	number: string,
	personId: string,
	name: string,
	seeNumber: string | null = null
) => ({
	number,
	generation: number.split('.').length,
	personId,
	name,
	isPrivate: false,
	seeNumber,
	sentences: [{ text: `${name} was born.`, notes: [] }]
});
const narrative = (kind: string, entries: unknown[]) => ({
	kind,
	person,
	generations: 2,
	hasMore: false,
	numbering: null,
	entries,
	endnotes: []
});

it('puts the ticked parts in its contents and indexes every name by part and number', () => {
	component = mount(Page, {
		target: document.body,
		props: {
			data: {
				summary: { tree: { id: 't1', slug: 'foxes', name: 'Foxes' } },
				book: {
					sections: ['ancestors', 'descendants', 'index'],
					generations: 2,
					ancestors: narrative('ancestors', [
						entry('1', 'a', 'Ann Fox'),
						entry('2', 'b', 'Bob Ash')
					]),
					descendants: narrative('descendants', [
						entry('1', 'a', 'Ann Fox'),
						entry('1.1', 'b', 'Bob Ash', '2')
					]),
					pedigree: { person, generations: 2, slots: [person], hasMoreAbove: false }
				}
			}
		} as never
	});
	const contents = document.querySelector('[data-testid="book-contents"]')!.textContent!;
	expect(contents).toContain('Ancestors');
	expect(contents).not.toContain('Research gaps');
	const index = [...document.querySelectorAll('[data-testid="book-index"] li')].map((li) =>
		li.textContent!.replace(/\s+/g, ' ').trim()
	);
	// Surname first, under letters; a "see number" repeat and the folded D1 are not indexed again.
	expect(index).toEqual(['Ash, Bob A2', 'Fox, Ann A1']);
	expect(document.getElementById('d-entry-1')!.textContent).toContain('Told under A1');
	expect(document.getElementById('d-entry-1')!.textContent).not.toContain('was born');
	expect(document.getElementById('a-entry-2')).not.toBeNull();
	expect(document.getElementById('d-entry-1')).not.toBeNull();
});
