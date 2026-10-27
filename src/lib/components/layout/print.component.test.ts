import { afterEach, describe, expect, it } from 'vitest';
import { onPrint, openForPrint } from './print';

afterEach(() => {
	document.body.innerHTML = '';
});

describe('openForPrint', () => {
	it('opens the closed disclosures and closes only those again', () => {
		document.body.innerHTML =
			'<details id="a"><summary>A</summary></details><details id="b" open><summary>B</summary></details>';
		const a = document.getElementById('a') as HTMLDetailsElement;
		const b = document.getElementById('b') as HTMLDetailsElement;
		const restore = openForPrint(document);
		expect([a.open, b.open]).toEqual([true, true]);
		restore();
		expect([a.open, b.open]).toEqual([false, true]);
	});
});

describe('onPrint', () => {
	it('runs before on beforeprint, its result on afterprint, and stops when cleaned up', () => {
		const calls: string[] = [];
		const stop = onPrint(() => {
			calls.push('before');
			return () => calls.push('after');
		});
		window.dispatchEvent(new Event('beforeprint'));
		window.dispatchEvent(new Event('afterprint'));
		stop();
		window.dispatchEvent(new Event('beforeprint'));
		expect(calls).toEqual(['before', 'after']);
	});

	it('restores on cleanup if the print never finished', () => {
		const calls: string[] = [];
		const stop = onPrint(() => () => calls.push('after'));
		window.dispatchEvent(new Event('beforeprint'));
		stop();
		expect(calls).toEqual(['after']);
	});
});
