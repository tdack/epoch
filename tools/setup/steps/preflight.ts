import type { StepContext } from '../context.ts';
import { ERROR_CODES, SetupError } from '../errors.ts';
import { AUTH_MODES, newManifest, loadManifest, withStepDone, type Manifest } from '../manifest.ts';
import { assertValidSlug } from '../names.ts';
import { DEFAULT_SLUG, DEPLOY_AUTHS, type SetupFlags } from '../options.ts';

export type TokenSource = 'shell' | '.env';

/** Reads `CLOUDFLARE_API_TOKEN` the way wrangler's dotenv loading would, without evaluating anything. */
export function detectEnvToken(
	env: NodeJS.ProcessEnv,
	envFileText: string | null
): TokenSource | null {
	if (env.CLOUDFLARE_API_TOKEN) return 'shell';
	if (envFileText === null) return null;
	for (const line of envFileText.split('\n')) {
		const match = /^\s*(?:export\s+)?CLOUDFLARE_API_TOKEN\s*=\s*(.*)$/.exec(line);
		if (match && match[1]!.trim().replace(/^['"]|['"]$/g, '') !== '') return '.env';
	}
	return null;
}

function nodeMajor(version: string): number {
	return Number(version.split('.')[0]);
}

export interface PreflightResult {
	manifest: Manifest;
	/** True when `.epoch/install.json` already existed: a re-run resumes or updates, never reinstalls. */
	isResume: boolean;
	tokenSource: TokenSource | null;
}

/** Local checks only; nothing here touches the network. */
export function preflight(ctx: StepContext, flags: SetupFlags): PreflightResult {
	if (nodeMajor(ctx.nodeVersion) < 24) {
		throw new SetupError(
			ERROR_CODES.prerequisite,
			`Node 24 or later is required; this is ${ctx.nodeVersion}`,
			{
				hint: 'Run `nvm use` in the repository.'
			}
		);
	}
	for (const [what, path] of [
		['cf', ctx.paths.cfBinary],
		['wrangler', ctx.paths.wranglerBinary]
	] as const) {
		if (!ctx.fs.exists(path)) {
			throw new SetupError(ERROR_CODES.prerequisite, `${what} is not installed (${path})`, {
				hint: 'Run `npm install` at the repository root, then `npm run setup` again.'
			});
		}
	}

	const tokenSource = detectEnvToken(
		ctx.env,
		ctx.fs.exists(ctx.paths.envFile) ? ctx.fs.read(ctx.paths.envFile) : null
	);
	if (tokenSource && !flags.isApiTokenEnv) {
		throw new SetupError(
			ERROR_CODES.environmentToken,
			`CLOUDFLARE_API_TOKEN is set (${tokenSource === 'shell' ? 'in your shell' : 'in .env'}), and both tools would use it instead of a login`,
			{
				hint: 'Unset it to sign in with a browser, or pass --api-token-env to use that token for everything.'
			}
		);
	}
	if (flags.isApiTokenEnv && !tokenSource) {
		throw new SetupError(
			ERROR_CODES.environmentToken,
			'--api-token-env needs CLOUDFLARE_API_TOKEN, which is not set',
			{
				flag: '--api-token-env'
			}
		);
	}
	if (flags.isApiTokenEnv && flags.deployAuth === DEPLOY_AUTHS.ephemeral) {
		throw new SetupError(
			ERROR_CODES.usage,
			'--deploy-auth=ephemeral cannot be combined with --api-token-env',
			{
				flag: '--deploy-auth'
			}
		);
	}

	const existing = loadManifest(ctx.fs, ctx.paths.manifestFile);
	if (existing && flags.slug && flags.slug !== existing.slug) {
		throw new SetupError(
			ERROR_CODES.usage,
			`This checkout is install "${existing.slug}"; one checkout is one install`,
			{
				flag: '--slug',
				hint: 'Use another clone for a second install.'
			}
		);
	}
	const slug = existing?.slug ?? flags.slug ?? DEFAULT_SLUG;
	assertValidSlug(slug);

	const base = existing ?? newManifest(slug, ctx.now());
	const authMode = flags.isApiTokenEnv
		? AUTH_MODES.envToken
		: flags.deployAuth === DEPLOY_AUTHS.ephemeral
			? AUTH_MODES.ephemeral
			: AUTH_MODES.profile;
	const manifest = ctx.save(withStepDone({ ...base, authMode }, 'preflight'));
	return { manifest, isResume: existing !== null, tokenSource };
}
