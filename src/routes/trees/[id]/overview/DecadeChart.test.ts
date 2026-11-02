import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import DecadeChart from './DecadeChart.svelte';

const html = (decades: { decade: number; people: number }[]) =>
	render(DecadeChart, { props: { decades, labelledBy: 'h' } }).body;
const count = (s: string, needle: string) => s.split(needle).length - 1;

describe('DecadeChart', () => {
	it('names every non-empty decade and hides empty ones behind one summary line', () => {
		const out = html([
			{ decade: 1840, people: 1 },
			{ decade: 1850, people: 0 },
			{ decade: 1860, people: 3 }
		]);
		expect(out).toContain('aria-label="1840s: 1 birth"');
		expect(out).toContain('aria-label="1860s: 3 births"');
		expect(count(out, 'tabindex="0"')).toBe(1);
		expect(count(out, 'tabindex="-1"')).toBe(1);
		expect(out).toContain('No dated births in 1 other decades.');
		expect(out).toContain('border-dotted');
	});

	it('prints every value without hover when there are 12 decades or fewer', () => {
		const few = html([
			{ decade: 1840, people: 5 },
			{ decade: 1850, people: 2 }
		]);
		expect(few).not.toContain('opacity-0');
		const many = html(
			Array.from({ length: 13 }, (_, i) => ({ decade: 1840 + i * 10, people: i + 1 }))
		);
		expect(count(many, 'opacity-0')).toBe(12);
	});

	it('captions the peak decade on load with previous/next buttons', () => {
		const out = html([
			{ decade: 1840, people: 1 },
			{ decade: 1850, people: 0 },
			{ decade: 1860, people: 3 }
		]);
		expect(out).toContain('>1860s: 3 births</p>');
		expect(out).toContain('aria-label="Previous decade"');
		expect(out).toContain('aria-label="Next decade"');
	});
});
