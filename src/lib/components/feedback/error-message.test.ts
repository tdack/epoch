import { describe, expect, it } from 'vitest';
import { messageOf } from './error-message.js';

describe('messageOf', () => {
	it('returns the message of an Error', () => {
		expect(messageOf(new Error('boom'), 'fallback')).toBe('boom');
	});
	it('falls back when the message is empty', () => {
		expect(messageOf(new Error(''), 'fallback')).toBe('fallback');
	});
	it('falls back for non-Error values', () => {
		expect(messageOf('boom', 'fallback')).toBe('fallback');
		expect(messageOf(null, 'fallback')).toBe('fallback');
		expect(messageOf({ message: 'boom' }, 'fallback')).toBe('fallback');
	});
});
