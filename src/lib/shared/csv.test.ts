import { describe, expect, it } from 'vitest';
import { toCsv } from './csv';

describe('toCsv', () => {
	it('joins with commas and CRLF, ending in a line break', () => {
		expect(toCsv(['a', 'b'], [['1', 2]])).toBe('a,b\r\n1,2\r\n');
	});

	it('quotes cells with a comma, quote or line break, and doubles quotes', () => {
		expect(toCsv(['x'], [['a,b'], ['say "hi"'], ['one\ntwo'], [null]])).toBe(
			'x\r\n"a,b"\r\n"say ""hi"""\r\n"one\ntwo"\r\n\r\n'
		);
	});

	it('makes a cell that starts like a formula into text', () => {
		const out = toCsv(['x'], [['=1+1'], ['+1'], ['-1'], ['@SUM(A1)'], ['a=b']]);
		expect(out).toBe("x\r\n'=1+1\r\n'+1\r\n'-1\r\n'@SUM(A1)\r\na=b\r\n");
	});

	it('quotes a guarded cell that also needs quoting', () => {
		expect(toCsv(['x'], [['=a,b']])).toBe('x\r\n"\'=a,b"\r\n');
	});
});
