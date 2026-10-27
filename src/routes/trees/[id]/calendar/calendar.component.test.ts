import { afterEach, describe, expect, it } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import Page from './+page.svelte';

let component: Record<string, unknown> | null = null;
afterEach(() => {
	if (component) unmount(component);
	component = null;
	document.body.innerHTML = '';
});

function render(entries: unknown[]) {
	component = mount(Page, {
		target: document.body,
		props: {
			data: {
				summary: { tree: { id: 't1', slug: 'simpsons', name: 'Simpsons' } },
				month: 5,
				entries
			}
		} as never
	});
	flushSync();
}

describe('the calendar page', () => {
	it('lists a month by day with the date as written in the tree format, and offers downloads', () => {
		render([
			{
				id: 'e1',
				type: 'BIRT',
				monthDay: '05-12',
				year: 1956,
				people: [{ id: 'p1', name: 'Homer Simpson' }],
				unionId: null,
				isCurrent: false
			}
		]);
		const row = document.querySelector('tbody tr')!;
		expect(row.querySelector('th')?.textContent).toBe('12 May');
		expect(row.textContent).toContain('Homer Simpson born');
		expect(row.textContent).toContain('12 May 1956');
		expect(document.querySelector('label[for=month]')?.textContent).toBe('Month');
		expect(document.body.textContent).toContain('Download CSV');
		expect(document.querySelector('a[href$="/calendar/anniversaries.ics"]')).not.toBeNull();
	});

	it('says so when the month is empty', () => {
		render([]);
		expect(document.querySelector('table')).toBeNull();
		expect(document.body.textContent).toContain('Nothing you can see is recorded');
	});
});
