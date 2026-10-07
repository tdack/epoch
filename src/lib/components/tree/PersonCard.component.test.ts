import { afterEach, describe, expect, it, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import PersonCard from './PersonCard.svelte';
import type { PlacedPerson } from '#lib/tree-layout/index.js';
import type { LevelOfDetail } from './tree-view.js';

let component: Record<string, unknown> | null = null;
afterEach(() => {
	if (component) unmount(component);
	component = null;
	document.body.innerHTML = '';
});

const node = {
	id: 'p1',
	x: 0,
	y: 0,
	generation: 0,
	role: 'focus',
	person: { id: 'p1', displayName: 'Ada Lovelace', sex: 'F', isDeceased: false }
} as unknown as PlacedPerson;

function render(level: LevelOfDetail, isFocus: boolean, isSelected = false) {
	document.body.innerHTML = '<svg></svg>';
	const target = document.querySelector('svg')!;
	component = mount(PersonCard, {
		target,
		props: {
			node,
			level,
			zoom: 1,
			isFocus,
			isSelected,
			isActive: true,
			hasMultiplePaths: false,
			relation: 'focus person',
			onSelect: vi.fn(),
			onOpen: vi.fn(),
			onContextMenu: vi.fn(),
			onPointerDown: vi.fn()
		}
	});
	flushSync();
	return target.querySelector('.card')!;
}

describe('PersonCard focus mark', () => {
	it.each(['full', 'compact', 'block'] as const)('draws the rule and tab at %s', (level) => {
		const card = render(level, true);
		expect(card.querySelector('.focus-rule')).not.toBeNull();
		expect(card.querySelector('.focus-tab')).not.toBeNull();
		expect(card.getAttribute('aria-current')).toBe('true');
	});

	it('keeps the mark when the focus card is also selected', () => {
		const card = render('full', true, true);
		expect(card.classList.contains('is-selected')).toBe(true);
		expect(card.querySelector('.focus-rule')).not.toBeNull();
	});

	it('draws no mark on other cards', () => {
		const card = render('full', false);
		expect(card.querySelector('.focus-rule')).toBeNull();
		expect(card.getAttribute('aria-current')).toBeNull();
	});

	it('hides the decoration from assistive tech', () => {
		const card = render('full', true);
		expect(card.querySelector('.focus-tab')!.getAttribute('aria-hidden')).toBe('true');
	});
});
