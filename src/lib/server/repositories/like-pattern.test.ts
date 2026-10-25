import { describe, expect, it } from 'vitest';
import { likePattern } from './like-pattern';

const bytes = (s: string) => new TextEncoder().encode(s).length;
const hasLoneSurrogate = (s: string) => !s.isWellFormed();

describe('likePattern', () => {
	it('wraps and escapes a short query', () => {
		expect(likePattern('50%_a\\')).toBe('%50\\%\\_a\\\\%');
	});

	it('bounds ASCII to 50 bytes', () => {
		const p = likePattern('a'.repeat(200));
		expect(bytes(p)).toBe(50);
		expect(p).toBe(`%${'a'.repeat(48)}%`);
	});

	it('bounds accented and emoji input without splitting a code point', () => {
		for (const unit of ['é', '日', '😀', 'a😀']) {
			const p = likePattern(unit.repeat(100));
			expect(bytes(p)).toBeLessThanOrEqual(50);
			expect(hasLoneSurrogate(p)).toBe(false);
		}
	});

	it('counts the escapes in the bound and never leaves a dangling backslash', () => {
		for (const q of ['%'.repeat(100), '_'.repeat(100), 'a%'.repeat(100), '\\'.repeat(100)]) {
			const p = likePattern(q);
			expect(bytes(p)).toBeLessThanOrEqual(50);
			const body = p.slice(1, -1);
			expect(body.replace(/\\[\\%_]/g, '')).not.toMatch(/[\\%_]/);
		}
	});

	it('honours custom head and tail within the bound', () => {
		const p = likePattern('b'.repeat(100), '% ', ' %');
		expect(bytes(p)).toBe(50);
		expect(p.startsWith('% b')).toBe(true);
		expect(p.endsWith('b %')).toBe(true);
	});

	it('a trimmed pattern still matches the full text as a prefix', () => {
		const title = 'Census of England and Wales 1881, household schedule for the parish of St Mary';
		const body = likePattern(title).slice(1, -1);
		expect(title.startsWith(body)).toBe(true);
	});
});
