import { describe, expect, it } from 'vitest';
import { CommandError } from './errors.ts';
import { installPaths } from './paths.ts';
import { createExec, createRedactor, createRunner, mapFailure, unwrapEnvelope } from './run.ts';
import { fakeExec } from './testing.ts';

describe('mapFailure', () => {
	it.each([
		['You need a Workers Paid plan to use Queues', 'This needs a Workers Paid plan'],
		['Error 401 Unauthorized', 'Not signed in, or the sign-in has expired'],
		[
			'403 Forbidden: missing scope access-app.write',
			'The sign-in lacks a permission this step needs'
		],
		['429 Too many requests', 'Cloudflare is rate limiting this account; wait a minute and retry'],
		['fetch failed: ENOTFOUND api.cloudflare.com', 'Could not reach Cloudflare']
	])('maps %j to one line', (output, reason) => {
		expect(mapFailure(output)).toBe(reason);
	});

	it('falls back to the first non-empty line, trimmed', () => {
		expect(
			mapFailure(`\n\n  something odd happened ${'x'.repeat(300)}\nsecond`).length
		).toBeLessThanOrEqual(160);
		expect(mapFailure('\nweird failure\nmore')).toBe('weird failure');
	});
});

describe('unwrapEnvelope', () => {
	it('returns the result of an API envelope and leaves a bare result alone', () => {
		expect(unwrapEnvelope({ success: true, result: [1] })).toEqual([1]);
		expect(unwrapEnvelope([1])).toEqual([1]);
		expect(unwrapEnvelope({ result: 'a document that happens to have a result field' })).toEqual({
			result: 'a document that happens to have a result field'
		});
	});
});

describe('redactor', () => {
	it('removes registered secrets and token-shaped strings', () => {
		const redactor = createRedactor();
		redactor.add('super-secret-value');
		expect(
			redactor.redact(
				'use super-secret-value and cfut_abcdefghijklmnop and Bearer abcdefghijklmnopqrstu'
			)
		).toBe('use [redacted] and [redacted] and [redacted]');
	});
	it('ignores very short secrets so it never blanks ordinary text', () => {
		const redactor = createRedactor();
		redactor.add('a');
		expect(redactor.redact('banana')).toBe('banana');
	});
});

describe('runner', () => {
	it('parses JSON from stdout', async () => {
		const runner = createRunner(
			fakeExec([{ match: 'cf accounts list', stdout: { success: true, result: [{ id: 'x' }] } }])
		);
		expect(await runner.json({ tool: 'cf', args: ['accounts', 'list'] })).toEqual([{ id: 'x' }]);
	});

	it('turns a failing command into one reason, the log path and the command to re-run', async () => {
		const runner = createRunner(
			fakeExec([
				{ match: 'cf queues create', exitCode: 1, stderr: 'You need a Workers Paid plan' }
			]),
			'/repo/.epoch/logs/x.log'
		);
		const error = await runner
			.json({ tool: 'cf', args: ['queues', 'create'] })
			.catch((e: unknown) => e);
		expect(error).toBeInstanceOf(CommandError);
		expect((error as CommandError).message).toBe('This needs a Workers Paid plan');
		expect((error as CommandError).hint).toContain('/repo/.epoch/logs/x.log');
		expect((error as CommandError).hint).toContain('Re-run: cf queues create');
	});

	it('reports output that is not JSON as such', async () => {
		const runner = createRunner(fakeExec([{ match: 'cf d1 list', stdout: 'Table: ...' }]));
		await expect(runner.json({ tool: 'cf', args: ['d1', 'list'] })).rejects.toThrow(
			'did not print JSON'
		);
	});
});

describe('the real exec', () => {
	it('refuses to run under Vitest, so no test can reach the machine’s Cloudflare login', () => {
		const exec = createExec({
			paths: installPaths('/repo'),
			logFile: '/repo/x.log',
			isVerbose: false,
			redactor: createRedactor()
		});
		expect(() => exec({ tool: 'cf', args: ['auth', 'whoami'] })).toThrow('Refusing to run');
	});
});
