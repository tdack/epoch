import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import type { PersonPageDto, PersonSummaryDto } from '#lib/shared/person-page.js';
import type { TreeRole } from '#lib/shared/roles.js';
import PersonView from './PersonView.svelte';

// PersonView sits under a tree layout in the app; this test mounts it bare, so the layout's context is stubbed.
vi.mock('#lib/components/tree/tree-context.js', () => ({
	getTreeContext: () => ({ toasts: { push: () => {} } })
}));

vi.mock('#lib/api/settings.js', () => ({ saveSelfPerson: vi.fn().mockResolvedValue({}) }));
vi.mock('$app/navigation', () => ({ goto: vi.fn(), invalidate: vi.fn() }));
import { saveSelfPerson } from '#lib/api/settings.js';

let component: Record<string, unknown> | null = null;
afterEach(() => {
	if (component) unmount(component);
	component = null;
	document.body.innerHTML = '';
	localStorage.clear();
});

const summary = (id: string, displayName: string): PersonSummaryDto => ({
	id,
	displayName,
	sex: 'U',
	birthDate: null,
	birthSort: null,
	deathDate: null,
	isDeceased: false,
	isPrivate: false
});

/** Only what the view reads; the rest of the DTO is irrelevant to it. */
function pageOf(
	id: string,
	name: string,
	extra: Partial<PersonPageDto> = {},
	sex: PersonPageDto['person']['sex'] | undefined = 'U'
): PersonPageDto {
	return {
		isPrivate: false,
		privacy: null,
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
		names: [],
		vitals: { birth: null, death: null, lifespan: null, hasConflict: false },
		facts: [],
		parentFamilies: [],
		partnerships: [],
		directChildren: [],
		siblings: { full: [], half: [] },
		stepParents: [],
		stepChildren: [],
		media: [],
		notes: [],
		linkNotes: [],
		tasks: { items: [], members: [] },
		evidence: { citations: [], links: [] },
		changes: { recent: [], createdAt: null, updatedAt: null },
		...extra
	} as unknown as PersonPageDto;
}

function open(
	dto: PersonPageDto,
	options: {
		layout?: 'drawer' | 'page';
		role?: TreeRole;
		selfPersonId?: string | null;
		isReadOnly?: boolean;
		relativeTarget?: Record<string, unknown>;
	} = {}
) {
	const onSelect = vi.fn();
	component = mount(PersonView, {
		target: document.body,
		props: {
			dto,
			treeId: 't',
			role: options.role ?? 'owner',
			selfPersonId: options.selfPersonId ?? null,
			layout: options.layout ?? 'drawer',
			relativeTarget: (options.relativeTarget ?? { kind: 'select', onSelect }) as never,
			editor: { openRelationship: vi.fn(), anchorFor: (id: string) => ({ id }) } as never,
			toasts: { push: vi.fn() } as never,
			marks: { favorites: [], isReadOnly: options.isReadOnly ?? false } as never
		}
	});
	flushSync();
	return { onSelect };
}

const steps = () => document.querySelector('[data-testid="step-relatives"]');
const headings = () => [...document.querySelectorAll('h3')].map((h) => h.textContent?.trim());

describe.each(['drawer', 'page'] as const)('PersonView relatives in the %s layout', (layout) => {
	it('lists a step-parent apart from parents and children', () => {
		open(
			pageOf('cal', 'Cal', { stepParents: [{ person: summary('dee', 'Dee'), unionId: 'u2' }] }),
			{ layout }
		);
		expect(steps()!.textContent).toContain('Dee');
		expect(steps()!.textContent).toContain('(step-parent)');
	});

	it('shows no step section for someone with none', () => {
		open(pageOf('ben', 'Ben'), { layout });
		expect(steps()).toBeNull();
	});

	it('lists siblings with half-siblings marked', () => {
		open(
			pageOf('cat', 'Cat', {
				siblings: { full: [summary('dan', 'Dan')], half: [summary('fay', 'Fay')] }
			}),
			{ layout }
		);
		const text = document.querySelector('[data-testid="siblings"]')!.textContent!;
		expect(text).toContain('Dan');
		expect(text).toContain('Fay');
		expect(text).toContain('(half-sibling)');
	});

	it('marks a fact that disagrees with another', () => {
		open(
			pageOf('ben', 'Ben', {
				facts: [
					{
						id: 'b1',
						type: 'birth',
						label: 'Birth',
						dateText: '1900',
						place: null,
						value: null,
						notes: null,
						citationCount: 0,
						noteItems: [],
						retainedLines: [],
						conflict: { kind: 'conflict', otherIds: ['b2'] }
					} as never
				]
			}),
			{ layout }
		);
		expect(document.body.textContent).toContain('Disagrees with 1 other recorded birth');
	});

	it('offers every relative action', () => {
		open(
			pageOf('kid', 'Kid', {
				parentFamilies: [
					{
						unionId: 'u',
						label: null,
						parents: [{ person: summary('mum', 'Mum'), type: 'biological' }]
					} as never
				]
			}),
			{ layout }
		);
		const labels = [...document.querySelectorAll('button')].map(
			(b) => b.getAttribute('aria-label') ?? b.textContent?.trim()
		);
		expect(labels).toContain('Options for Mum: record what happened, or remove');
		expect(labels).toContain('+ Add parent');
		expect(labels).toContain('+ Add sibling');
		expect(document.querySelector('input[type="file"]')).not.toBeNull();
	});

	it("files a parent link's evidence under the parent row", () => {
		open(
			pageOf('kid', 'Kid', {
				parentFamilies: [
					{
						unionId: 'u',
						label: null,
						parents: [
							{ person: summary('mum', 'Mum'), type: 'biological', linkId: 'pc1' },
							{ person: summary('dad', 'Dad'), type: 'biological', linkId: 'pc2' }
						]
					} as never
				],
				evidence: {
					citations: [
						{
							id: 'c1',
							subject: { kind: 'parent_child', id: 'pc1' },
							sourceLabel: 'Census 1851',
							notes: []
						} as never
					],
					links: []
				}
			}),
			{ layout }
		);
		const rows = [...document.querySelectorAll('[data-testid="parents"] > ul > li')];
		expect(rows).toHaveLength(2);
		expect(rows[0]!.querySelector('[data-testid="claim-state"]')?.getAttribute('data-state')).toBe(
			'sourced'
		);
		// An unsourced link shows nothing, and a first source comes from the quiet link.
		expect(rows[1]!.querySelector('[data-testid="claim-state"]')).toBeNull();
		expect(
			rows[1]!.querySelector('button[aria-label="Add a source for Dad as parent"]')
		).not.toBeNull();
	});

	it('shows a viewer the family without the controls that would change it', () => {
		open(
			pageOf('kid', 'Kid', {
				parentFamilies: [
					{
						unionId: 'u',
						label: null,
						parents: [{ person: summary('mum', 'Mum'), type: 'biological' }]
					} as never
				]
			}),
			{ layout, role: 'viewer' }
		);
		const labels = [...document.querySelectorAll('button')].map(
			(b) => b.getAttribute('aria-label') ?? b.textContent?.trim() ?? ''
		);
		expect(document.body.textContent).toContain('Mum');
		for (const hidden of ['Options for Mum', '+ Add parent', 'Edit', 'Delete…', 'Record death'])
			expect(labels.some((label) => label.startsWith(hidden))).toBe(false);
	});

	it('lets a contributor add relatives but not change or remove them', () => {
		open(
			pageOf('kid', 'Kid', {
				parentFamilies: [
					{
						unionId: 'u',
						label: null,
						parents: [{ person: summary('mum', 'Mum'), type: 'biological' }]
					} as never
				]
			}),
			{ layout, role: 'contributor' }
		);
		const labels = [...document.querySelectorAll('button')].map(
			(b) => b.getAttribute('aria-label') ?? b.textContent?.trim() ?? ''
		);
		expect(labels).toContain('+ Add parent');
		expect(labels.some((label) => label.startsWith('Options for Mum'))).toBe(false);
		expect(labels).not.toContain('Delete…');
	});
});

describe('Make sub-tree from here', () => {
	const offered = () => document.querySelector('[data-testid="make-subtree"]') !== null;

	it.each([
		['viewer', false],
		['editor', false],
		['manager', true],
		['owner', true]
	] as const)('is %s-visible: %s', (role, isShown) => {
		open(pageOf('ben', 'Ben'), { role });
		expect(offered()).toBe(isShown);
	});
});

describe('relativeTarget', () => {
	const family = () =>
		pageOf('cat', 'Cat', { siblings: { full: [summary('dan', 'Dan')], half: [] } });

	it('selects in place on the canvas', () => {
		const { onSelect } = open(family());
		const sibling = document.querySelector<HTMLButtonElement>('[data-testid="siblings"] button')!;
		sibling.click();
		expect(onSelect).toHaveBeenCalledWith('dan');
		expect(document.querySelector('[data-testid="siblings"] a')).toBeNull();
	});

	it('is a link to their page on the person page', () => {
		open(family(), { layout: 'page', relativeTarget: { kind: 'link' } });
		const link = document.querySelector('[data-testid="siblings"] a')!;
		expect(link.getAttribute('href')).toBe('/trees/t/people/dan');
		expect(document.querySelector('[data-testid="siblings"] button.link')).toBeNull();
	});
});

describe('drawer layout', () => {
	it('folds every section after the summary into a details block with a real heading', () => {
		open(pageOf('ben', 'Ben'));
		const details = [...document.querySelectorAll('details')];
		expect(details.length).toBeGreaterThan(5);
		for (const d of details) expect(d.querySelector('summary > h3')).not.toBeNull();
		expect(document.querySelector('section.section-card')).toBeNull();
	});

	it('opens Family and Facts by default and keeps the rest closed', () => {
		open(pageOf('ben', 'Ben'));
		const isOpen = (id: string) =>
			document.querySelector<HTMLDetailsElement>(`details[data-section="${id}"]`)!.open;
		expect(isOpen('family')).toBe(true);
		expect(isOpen('facts')).toBe(true);
		expect(isOpen('names')).toBe(false);
		expect(isOpen('media')).toBe(false);
		expect(isOpen('history')).toBe(false);
	});

	it('remembers a section the viewer opened, keyed by section and not by person', async () => {
		open(pageOf('ben', 'Ben'));
		const names = document.querySelector<HTMLDetailsElement>('details[data-section="names"]')!;
		names.open = true;
		names.dispatchEvent(new Event('toggle'));
		expect(localStorage.getItem('epoch.person-section.names')).toBe('1');

		unmount(component!);
		document.body.innerHTML = '';
		open(pageOf('someone-else', 'Someone Else'));
		expect(document.querySelector<HTMLDetailsElement>('details[data-section="names"]')!.open).toBe(
			true
		);
	});

	it('renders when storage throws', () => {
		const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
			throw new Error('blocked');
		});
		const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
			throw new Error('blocked');
		});
		open(pageOf('ben', 'Ben'));
		const family = document.querySelector<HTMLDetailsElement>('details[data-section="family"]')!;
		expect(family.open).toBe(true);
		family.open = false;
		expect(() => family.dispatchEvent(new Event('toggle'))).not.toThrow();
		get.mockRestore();
		set.mockRestore();
	});
});

describe('page layout', () => {
	it('uses cards with their headings, not details', () => {
		open(pageOf('ben', 'Ben'), { layout: 'page', relativeTarget: { kind: 'link' } });
		expect(document.querySelector('details')).toBeNull();
		expect(headings()).toEqual(
			expect.arrayContaining(['Life', 'Family', 'Names', 'Photos and documents', 'History'])
		);
	});

	it('leads with At a glance only for a person with attributes', () => {
		const sections = () =>
			[...document.querySelectorAll('[data-section]')].map((el) => el.getAttribute('data-section'));
		open(pageOf('ben', 'Ben'), { layout: 'page' });
		expect(sections()).not.toContain('glance');
		document.body.innerHTML = '';
		const occupation = {
			id: 'o1',
			type: 'OCCU',
			label: 'Occupation',
			kind: 'attribute',
			dateText: null,
			sortStart: null,
			place: null,
			value: 'Joiner',
			notes: null,
			citationCount: 0,
			noteItems: [],
			retainedLines: [],
			conflict: null
		} as never;
		open(pageOf('ben', 'Ben', { facts: [occupation] }), { layout: 'page' });
		expect(sections().slice(0, 2)).toEqual(['glance', 'life']);
	});

	it('shows privacy only to a manager whose DTO carries the setting', () => {
		const dto = pageOf('ben', 'Ben', {
			privacy: { setting: 'auto', isLikelyLiving: false, isRecentlyDead: false } as never
		});
		open(dto, { layout: 'page', role: 'editor' });
		expect(document.querySelector('[data-testid="privacy-panel"]')).toBeNull();
		unmount(component!);
		document.body.innerHTML = '';
		open(dto, { layout: 'page', role: 'manager' });
		expect(document.querySelector('[data-testid="privacy-panel"]')).not.toBeNull();
	});

	it('shows merge only to an editor or above', () => {
		open(pageOf('ben', 'Ben'), { layout: 'page', role: 'contributor' });
		expect(document.querySelector('[data-testid="merge-person"]')).toBeNull();
		unmount(component!);
		document.body.innerHTML = '';
		open(pageOf('ben', 'Ben'), { layout: 'page', role: 'editor' });
		expect(document.querySelector('[data-testid="merge-person"]')).not.toBeNull();
	});
});

describe('summary', () => {
	it.each([
		['M', 'Male'],
		['F', 'Female'],
		['X', 'Other'],
		['U', 'Unknown'],
		[undefined, 'Unknown']
	])('labels sex %s as %s', (sex, label) => {
		open(pageOf('ben', 'Ben', {}, sex as PersonPageDto['person']['sex'] | undefined));
		expect(document.body.textContent).toContain(label);
	});

	const initialsOf = (given: string | null, surname: string | null, displayName: string) => {
		const dto = pageOf('p', displayName);
		dto.person.givenName = given;
		dto.person.surname = surname;
		open(dto);
		return document.querySelector('[data-testid="initials"]')!.textContent;
	};

	it('uses the first given name and the surname for the initials', () => {
		expect(initialsOf('Jane Mary', 'Doe', 'Jane Mary Doe')).toBe('JD');
	});

	it('falls back to the first and last words of the display name', () => {
		expect(initialsOf(null, null, 'Ada Byron King')).toBe('AK');
	});

	it('shows one letter for a single name', () => {
		expect(initialsOf('Cher', null, 'Cher')).toBe('C');
	});
});

describe('PersonView section order', () => {
	const ORDER = ['family', 'facts', 'names', 'media', 'privacy', 'notes', 'tasks', 'history'];
	const sectionIds = () =>
		[...document.querySelectorAll<HTMLElement>('[data-section]')].map((el) => el.dataset.section);
	/** The column a section sits in on the page: its parent. */
	const column = (id: string) => document.querySelector(`[data-section="${id}"]`)!.parentElement;

	it('lists the sections in one order in the drawer', () => {
		open(pageOf('ben', 'Ben', {}, 'M'), { layout: 'drawer', role: 'owner' });
		expect(sectionIds()).toEqual(ORDER.filter((id) => sectionIds().includes(id)));
		expect(sectionIds()).toEqual(expect.arrayContaining(['family', 'facts', 'names', 'history']));
	});

	it('leads the page with Life and Family, and gathers the rest of the record in one column', () => {
		const PAGE_ORDER = ['life', 'family', 'notes', 'names', 'media', 'tasks', 'privacy', 'history'];
		open(pageOf('ben', 'Ben', {}, 'M'), { layout: 'page', role: 'owner' });
		expect(sectionIds()).toEqual(PAGE_ORDER.filter((id) => sectionIds().includes(id)));
		expect(sectionIds()).not.toContain('facts');
		expect(column('life')).toBe(column('family'));
		expect(column('notes')).toBe(column('history'));
		expect(column('names')).toBe(column('media'));
		expect(column('life')).not.toBe(column('notes'));
	});

	it('has no separate sources section', () => {
		open(pageOf('ben', 'Ben'), { layout: 'drawer' });
		expect(document.querySelector('[data-section="evidence"]')).toBeNull();
	});
});

describe('PersonView "This is me"', () => {
	const toggle = () => document.querySelector<HTMLButtonElement>('[data-testid="self-toggle"]');
	const badge = () => document.querySelector('[data-testid="you-badge"]');

	it('links the member to the person, and shows no badge until they are', async () => {
		open(pageOf('ben', 'Ben'));
		expect(badge()).toBeNull();
		expect(toggle()!.textContent).toContain('This is me');
		toggle()!.click();
		await Promise.resolve();
		expect(saveSelfPerson).toHaveBeenCalledWith('t', 'ben');
	});

	it('badges the member’s own person and offers Not me, which clears it', async () => {
		open(pageOf('ben', 'Ben'), { selfPersonId: 'ben' });
		expect(badge()!.textContent).toContain('You');
		expect(toggle()!.textContent).toContain('Not me');
		toggle()!.click();
		await Promise.resolve();
		expect(saveSelfPerson).toHaveBeenCalledWith('t', null);
	});

	it('offers nothing to a reader with no account', () => {
		open(pageOf('ben', 'Ben'), { isReadOnly: true });
		expect(toggle()).toBeNull();
	});
});
