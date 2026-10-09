import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Runner } from './run.ts';

/**
 * Wrangler is what `npm run deploy` uses forever after, so setup deploys with it, under a
 * profile bound to the checkout (or a short-lived token passed only through the environment).
 * `wrangler auth` is marked experimental in 4.148 (SPIKE).
 */
export type WranglerAuth =
	| { kind: 'profile'; accountId: string }
	/** The minted or user-supplied token. Passed in the child's environment only, never on argv. */
	| { kind: 'token'; token: string; accountId: string };

export interface WranglerApi {
	authCreate(profile: string): Promise<void>;
	authActivate(profile: string, directory: string): Promise<void>;
	/** Identity wrangler sees, for the cross-check with `cf auth whoami`. */
	whoami(): Promise<{ email: string | null; accountIds: string[] }>;
	build(): Promise<void>;
	migrate(configFile: string): Promise<void>;
	deploy(configFile: string): Promise<void>;
	deleteWorker(name: string): Promise<void>;
	/** The OAuth or API token wrangler would send, for the one read-only call `cf` cannot make. SPIKE: output format. */
	getAuthToken(): Promise<string>;
	putObject(bucket: string, key: string, body: string): Promise<void>;
	getObject(bucket: string, key: string): Promise<string | null>;
}

export function createWranglerApi(runner: Runner, auth: WranglerAuth): WranglerApi {
	/** Profiles resolve by directory binding, so a stale token in the shell must not win over them. */
	function env(): Record<string, string | undefined> {
		return auth.kind === 'token'
			? { CLOUDFLARE_API_TOKEN: auth.token, CLOUDFLARE_ACCOUNT_ID: auth.accountId }
			: { CLOUDFLARE_API_TOKEN: undefined, CLOUDFLARE_ACCOUNT_ID: auth.accountId };
	}

	return {
		// Inherits the terminal: wrangler prints its own consent link (re-rendering is a SPIKE item).
		async authCreate(name) {
			await runner.text({ tool: 'wrangler', args: ['auth', 'create', name], isInteractive: true });
		},
		async authActivate(name, directory) {
			await runner.text({ tool: 'wrangler', args: ['auth', 'activate', name, directory] });
		},
		async whoami() {
			const out = await runner.json({ tool: 'wrangler', args: ['whoami', '--json'], env: env() });
			const rec = (typeof out === 'object' && out !== null ? out : {}) as Record<string, unknown>;
			const accounts = Array.isArray(rec.accounts)
				? (rec.accounts as Record<string, unknown>[])
				: [];
			return {
				email: typeof rec.email === 'string' ? rec.email : null,
				accountIds: accounts.map((a) => a.id).filter((id): id is string => typeof id === 'string')
			};
		},
		async build() {
			await runner.text({ tool: 'npm', args: ['run', 'build'], env: env() });
		},
		// `DB` is the binding name, so the command works whatever the workerName made the database.
		async migrate(configFile) {
			await runner.text({
				tool: 'wrangler',
				args: ['d1', 'migrations', 'apply', 'DB', '--remote', '-c', configFile],
				env: env()
			});
		},
		// The entry is positional (AGENTS.md Important Note 1): `main` stays at the adapter default.
		async deploy(configFile) {
			await runner.text({
				tool: 'wrangler',
				args: ['deploy', 'workers/entry.ts', '-c', configFile],
				env: env()
			});
		},
		// `wrangler auth token` prints the current credential; JSON with a token field, or the bare token (SPIKE).
		async getAuthToken() {
			const out = (
				await runner.text({
					tool: 'wrangler',
					args: ['auth', 'token'],
					env: env(),
					hasSecretOutput: true
				})
			).trim();
			try {
				const parsed = JSON.parse(out) as Record<string, unknown>;
				for (const key of ['token', 'oauth_token', 'api_token']) {
					if (typeof parsed[key] === 'string') return parsed[key];
				}
			} catch {
				// Not JSON: the output is the token itself.
			}
			return out;
		},
		async deleteWorker(name) {
			await runner.text({
				tool: 'wrangler',
				args: ['delete', '--name', name, '--force'],
				env: env()
			});
		},
		async putObject(bucket, key, body) {
			const dir = mkdtempSync(join(tmpdir(), 'epoch-setup-'));
			const file = join(dir, 'body');
			try {
				writeFileSync(file, body);
				await runner.text({
					tool: 'wrangler',
					args: [
						'r2',
						'object',
						'put',
						`${bucket}/${key}`,
						'--file',
						file,
						'--content-type',
						'application/json',
						'--remote'
					],
					env: env()
				});
			} finally {
				rmSync(dir, { recursive: true, force: true });
			}
		},
		async getObject(bucket, key) {
			const result = await runner.exec({
				tool: 'wrangler',
				args: ['r2', 'object', 'get', `${bucket}/${key}`, '--pipe', '--remote'],
				env: env()
			});
			return result.exitCode === 0 ? result.stdout : null;
		}
	};
}
