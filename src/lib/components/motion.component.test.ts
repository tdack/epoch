import { afterEach, describe, expect, it, vi } from 'vitest';
import { REDUCE_MOTION_ATTRIBUTE, shouldReduceMotion } from './motion';

afterEach(() => {
	vi.unstubAllGlobals();
	document.body.innerHTML = '';
});

function given(isOsReducing: boolean, isUserReducing: boolean) {
	vi.stubGlobal('matchMedia', () => ({ matches: isOsReducing }));
	const root = document.createElement('div');
	if (isUserReducing) root.setAttribute(REDUCE_MOTION_ATTRIBUTE, '');
	document.body.appendChild(root);
}

describe('shouldReduceMotion', () => {
	it.each([
		[false, false, false],
		[true, false, true],
		[false, true, true],
		[true, true, true]
	])('system %s, setting %s: reduce %s', (isOsReducing, isUserReducing, shouldReduce) => {
		given(isOsReducing, isUserReducing);
		expect(shouldReduceMotion()).toBe(shouldReduce);
	});
});
