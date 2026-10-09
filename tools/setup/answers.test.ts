import { describe, expect, it } from 'vitest';
import {
	ANSWER_SOURCES,
	isTypedNameMatch,
	resolveAnswer,
	resolveTypedConfirmation
} from './answers.ts';
import { ERROR_CODES, SetupError } from './errors.ts';

const TTY = { isYes: false, isInteractive: true };
const NO_TTY = { isYes: false, isInteractive: false };
const YES = { isYes: true, isInteractive: false };

function failure(fn: () => unknown): SetupError {
	try {
		fn();
	} catch (error) {
		return error as SetupError;
	}
	throw new Error('did not throw');
}

describe('resolveAnswer', () => {
	it('prefers the flag, then the only choice, then the default under --yes', () => {
		expect(
			resolveAnswer({ flag: '--zone', flagValue: 'a', onlyChoice: 'b', defaultValue: 'c' }, YES)
		).toEqual({ status: 'answered', value: 'a', source: ANSWER_SOURCES.flag });
		expect(
			resolveAnswer(
				{ flag: '--zone', flagValue: undefined, onlyChoice: 'b', defaultValue: 'c' },
				NO_TTY
			)
		).toEqual({ status: 'answered', value: 'b', source: ANSWER_SOURCES.only });
		expect(resolveAnswer({ flag: '--zone', flagValue: undefined, defaultValue: 'c' }, YES)).toEqual(
			{ status: 'answered', value: 'c', source: ANSWER_SOURCES.default }
		);
	});

	it('asks on a terminal', () => {
		expect(resolveAnswer({ flag: '--zone', flagValue: undefined, defaultValue: 'c' }, TTY)).toEqual(
			{ status: 'ask' }
		);
	});

	it('without a terminal, a missing answer is an error that names the flag, never a hang', () => {
		const error = failure(() =>
			resolveAnswer({ flag: '--hostname', flagValue: undefined, defaultValue: 'c' }, NO_TTY)
		);
		expect(error.code).toBe(ERROR_CODES.missingAnswer);
		expect(error.flag).toBe('--hostname');
		expect(error.message).toContain('--hostname');
		expect(error.hint).toContain('--yes');
	});

	it('--yes cannot invent an answer that has no default', () => {
		const error = failure(() => resolveAnswer({ flag: '--zone', flagValue: undefined }, YES));
		expect(error.flag).toBe('--zone');
		expect(error.hint).toContain('no safe default');
	});
});

describe('typed confirmations', () => {
	it('--yes refuses them', () => {
		const error = failure(() => resolveTypedConfirmation('epoch-db', undefined, YES));
		expect(error.code).toBe(ERROR_CODES.needsTypedConfirmation);
	});

	it('a non-interactive run refuses them too', () => {
		expect(failure(() => resolveTypedConfirmation('epoch-db', undefined, NO_TTY)).code).toBe(
			ERROR_CODES.needsTypedConfirmation
		);
	});

	it('--yes cannot be talked past by a wrong name either', () => {
		expect(failure(() => resolveTypedConfirmation('epoch-db', 'epoch-dbx', TTY)).code).toBe(
			ERROR_CODES.needsTypedConfirmation
		);
	});

	it('asks on a terminal, and accepts the exact name', () => {
		expect(resolveTypedConfirmation('epoch-db', undefined, TTY)).toBe('ask');
		expect(resolveTypedConfirmation('epoch-db', ' epoch-db ', TTY)).toBe('confirmed');
		expect(isTypedNameMatch('epoch-db', 'EPOCH-DB')).toBe(false);
	});
});
