import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';

vi.mock('#lib/api/evidence.js', () => ({
	fetchSources: vi.fn(async () => ({
		items: [
			{ id: 's1', title: 'Parish register', author: null },
			{ id: 's2', title: 'Census 1851', author: 'ONS' }
		]
	})),
	createSourceApi: vi.fn()
}));

import SourceSection from './SourceSection.svelte';

let component: Record<string, unknown> | null = null;
afterEach(() => {
	if (component) unmount(component);
	component = null;
	document.body.innerHTML = '';
});

const SEARCH_WAIT_MS = 350;

function render(extra: Record<string, unknown> = {}) {
	const seen: { current: unknown } = { current: undefined };
	component = mount(SourceSection, {
		target: document.body,
		props: {
			treeId: 't1',
			idPrefix: 'x',
			role: 'editor',
			isOpen: true,
			get citation() {
				return seen.current;
			},
			set citation(value: unknown) {
				seen.current = value;
			},
			onerror: vi.fn(),
			...extra
		}
	});
	flushSync();
	return seen;
}

describe('SourceSection', () => {
	it('picks a source with the keyboard and reports it as the citation', async () => {
		const seen = render();
		expect(seen.current).toBeNull();
		const details = document.querySelector('details')!;
		details.open = true;
		details.dispatchEvent(new Event('toggle'));
		flushSync();

		const input = document.querySelector<HTMLInputElement>('#x-source-search')!;
		expect(input.getAttribute('role')).toBe('combobox');
		input.value = 'a';
		input.dispatchEvent(new Event('input', { bubbles: true }));
		await new Promise((resolve) => setTimeout(resolve, SEARCH_WAIT_MS));
		flushSync();
		const options = document.querySelectorAll('[role="option"]');
		expect(options).toHaveLength(2);

		input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
		input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
		flushSync();
		expect(input.getAttribute('aria-activedescendant')).toBe(options[1]!.id);
		input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
		await tick();
		flushSync();

		expect(document.querySelector('[data-testid="chosen-source"]')!.textContent).toBe(
			'Census 1851'
		);
		expect(seen.current).toEqual({ sourceId: 's2', page: null, quality: null });
	});

	it('cites nothing when the section is closed', () => {
		const seen = render();
		expect(document.querySelector('details')!.open).toBe(false);
		expect(seen.current).toBeNull();
	});

	it('is absent for a role that cannot cite', () => {
		render({ role: 'viewer' });
		expect(document.querySelector('details')).toBeNull();
	});

	it('lists the existing citations and offers another', () => {
		render({
			existing: [{ id: 'c1', sourceLabel: 'Census 1851', page: 'p 4' }]
		});
		expect(document.querySelector('summary')!.textContent).toBe('Add another source');
		expect(document.querySelector('[data-testid="existing-sources"]')!.textContent).toContain(
			'Census 1851'
		);
	});
});
