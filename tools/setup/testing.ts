import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CloudflareApi } from './cloudflare.ts';
import { createCleanup, type FileSystem, type Reporter, type StepContext } from './context.ts';
import { installPaths } from './paths.ts';
import { createCloudflareApi } from './cloudflare.ts';
import {
	createRunner,
	describeCommand,
	type Exec,
	type ExecRequest,
	type ExecResult
} from './run.ts';
import { createWranglerApi, type WranglerApi } from './wrangler.ts';
import type { Manifest } from './manifest.ts';
import { newManifest } from './manifest.ts';

/** Test support, consumed by specs. The real `Exec` refuses to run under Vitest, so every test goes through here. */

export function fixture(name: string): unknown {
	return JSON.parse(readFileSync(join(import.meta.dirname, 'fixtures', name), 'utf8'));
}

export interface Rule {
	/** Matched against `tool arg arg …`. A string must be a prefix of it. */
	match: string | RegExp;
	stdout?: unknown;
	stderr?: string;
	exitCode?: number;
}

export interface FakeExec extends Exec {
	calls: ExecRequest[];
}

/** Answers from rules, first match wins. An unmatched command throws, so no test passes by accident. */
export function fakeExec(rules: Rule[]): FakeExec {
	const calls: ExecRequest[] = [];
	const exec = (async (request: ExecRequest): Promise<ExecResult> => {
		calls.push(request);
		const line = describeCommand(request);
		const rule = rules.find((r) =>
			typeof r.match === 'string' ? line.startsWith(r.match) : r.match.test(line)
		);
		if (!rule) throw new Error(`No fixture for: ${line}`);
		const stdout =
			rule.stdout === undefined
				? ''
				: typeof rule.stdout === 'string'
					? rule.stdout
					: JSON.stringify(rule.stdout);
		return { exitCode: rule.exitCode ?? 0, stdout, stderr: rule.stderr ?? '' };
	}) as FakeExec;
	exec.calls = calls;
	return exec;
}

export function memoryFs(
	files: Record<string, string> = {}
): FileSystem & { files: Record<string, string> } {
	const store = { ...files };
	return {
		files: store,
		exists: (path) => path in store || Object.keys(store).some((p) => p.startsWith(`${path}/`)),
		read(path) {
			const text = store[path];
			if (text === undefined) throw new Error(`ENOENT ${path}`);
			return text;
		},
		write: (path, text) => {
			store[path] = text;
		},
		list: (dir) =>
			Object.keys(store)
				.filter((p) => p.startsWith(`${dir}/`))
				.map((p) => p.slice(dir.length + 1))
	};
}

export function silentReporter(): Reporter & { warnings: string[]; infos: string[] } {
	const warnings: string[] = [];
	const infos: string[] = [];
	return { warnings, infos, info: (m) => infos.push(m), warn: (m) => warnings.push(m) };
}

/** A repo root that exists only in memory: both binaries "installed", the drizzle folder with two migrations. */
export const TEST_ROOT = '/repo';

export function baseFiles(): Record<string, string> {
	const paths = installPaths(TEST_ROOT);
	return {
		[paths.cfBinary]: '',
		[paths.wranglerBinary]: '',
		[paths.templateFile]: readFileSync(
			join(import.meta.dirname, 'templates', 'wrangler.template.jsonc'),
			'utf8'
		),
		[`${TEST_ROOT}/drizzle/0000_init.sql`]: '',
		[`${TEST_ROOT}/drizzle/0001_more.sql`]: ''
	};
}

interface ContextOptions {
	cf?: CloudflareApi;
	exec?: Exec;
	fs?: ReturnType<typeof memoryFs>;
	env?: NodeJS.ProcessEnv;
	nodeVersion?: string;
	wrangler?: Partial<WranglerApi>;
	fetch?: typeof fetch;
	/** Answers for the raw API reads (a Worker's settings). Anything unlisted is a 404. */
	raw?: (path: string) => { status: number; body: unknown };
}

export function testContext(options: ContextOptions = {}) {
	const exec = options.exec ?? fakeExec([]);
	const runner = createRunner(exec);
	const fs = options.fs ?? memoryFs(baseFiles());
	const saved: Manifest[] = [];
	const report = silentReporter();
	const cleanup = createCleanup();
	const raw =
		options.raw ?? (() => ({ status: 404, body: { success: false, errors: [{ code: 10007 }] } }));
	const ctx: StepContext = {
		paths: installPaths(TEST_ROOT),
		runner,
		cf:
			options.cf ??
			createCloudflareApi(runner, {
				rawGet: async (path) => raw(path),
				rawRequest: async (_method, path) => raw(path)
			}),
		makeWrangler: () => ({
			...createWranglerApi(runner, { kind: 'profile', accountId: 'acc' }),
			...options.wrangler
		}),
		cleanup,
		report,
		fs,
		env: options.env ?? {},
		save: (manifest) => {
			saved.push(manifest);
			return manifest;
		},
		now: () => new Date('2026-10-09T00:00:00Z'),
		fetch: options.fetch ?? (async () => new Response('', { status: 200 })),
		sleep: async () => {},
		nodeVersion: options.nodeVersion ?? '24.11.1'
	};
	return { ctx, saved, report, fs, exec, cleanup };
}

export function testManifest(overrides: Partial<Manifest> = {}): Manifest {
	return {
		...newManifest('epoch', new Date('2026-10-09T00:00:00Z')),
		installId: '11111111-1111-4111-8111-111111111111',
		...overrides
	};
}

/** A CloudflareApi where anything not overridden fails the test, so a step cannot call something unexpected. */
export function stubApi(overrides: Partial<CloudflareApi> = {}): CloudflareApi {
	return new Proxy(overrides as CloudflareApi, {
		get(target, property: string) {
			if (property in target) return target[property as keyof CloudflareApi];
			if (property === 'useAccount') return () => {};
			// An account with no tags and no way to read a Worker's script id: what the flow tests assumed before tags.
			if (property === 'listTagged') return async () => [];
			if (property === 'getWorkerScriptId') return async () => null;
			if (property === 'getTags') return async () => ({ tags: {}, etag: 'v1:empty' });
			if (property === 'putTags') return async () => {};
			return () => {
				throw new Error(`Unexpected cf call: ${property}`);
			};
		}
	});
}

export const NO_ASKER = {
	select: () => Promise.reject(new Error('unexpected prompt: select')),
	multiselect: () => Promise.reject(new Error('unexpected prompt: multiselect')),
	text: () => Promise.reject(new Error('unexpected prompt: text')),
	confirm: () => Promise.reject(new Error('unexpected prompt: confirm'))
};
