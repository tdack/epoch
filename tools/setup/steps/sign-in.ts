import type { StepContext } from '../context.ts';
import { ERROR_CODES, SetupError } from '../errors.ts';
import { AUTH_MODES, withStepDone, type Manifest } from '../manifest.ts';
import { resourceNames } from '../names.ts';
import type { SetupFlags } from '../options.ts';
import {
	assertScopesGranted,
	missingTagScopes,
	requestedScopes,
	requiredScopes
} from '../scopes.ts';
import type { Identity } from '../cloudflare.ts';

/** Both logins must be the same person on a shared account, or deploys would go somewhere else. */
export function assertSameIdentity(
	cfIdentity: Identity,
	wrangler: { email: string | null; accountIds: string[] }
): void {
	const isEmailDifferent =
		cfIdentity.email !== null &&
		wrangler.email !== null &&
		cfIdentity.email.toLowerCase() !== wrangler.email.toLowerCase();
	const hasSharedAccount =
		cfIdentity.accountIds.length === 0 ||
		wrangler.accountIds.length === 0 ||
		cfIdentity.accountIds.some((id) => wrangler.accountIds.includes(id));
	if (isEmailDifferent || !hasSharedAccount) {
		throw new SetupError(
			ERROR_CODES.identityMismatch,
			`cf is signed in as ${cfIdentity.email ?? 'unknown'} but wrangler as ${wrangler.email ?? 'unknown'}`,
			{
				hint: 'Sign both in with the same Cloudflare account (`wrangler auth create` / `cf auth create`), then retry.'
			}
		);
	}
}

/**
 * Signs `cf` and wrangler in with directory-bound profiles, then checks what was granted. The
 * profile is bound to the repository root, not to this tool's folder, so a later
 * `npm run deploy` finds it.
 */
export async function signIn(
	ctx: StepContext,
	manifest: Manifest,
	flags: SetupFlags
): Promise<{ manifest: Manifest; identity: Identity }> {
	const names = resourceNames(manifest.workerName);

	if (manifest.authMode === AUTH_MODES.envToken) {
		const identity = await ctx.cf.whoami();
		return { manifest: ctx.save(withStepDone(manifest, 'sign-in')), identity };
	}

	let identity: Identity | null = null;
	if (!flags.isForce) {
		try {
			identity = await ctx.cf.whoami();
		} catch {
			identity = null;
		}
	}
	if (identity === null) {
		const args = [
			'auth',
			'create',
			names.profile,
			'--scopes',
			...requestedScopes(manifest.authMode)
		];
		if (!flags.isBrowser) args.push('--no-browser');
		if (!flags.isDevice) args.push('--no-device');
		// Inherits the terminal so the user sees cf's own link and code (re-rendering is a SPIKE item).
		await ctx.runner.text({ tool: 'cf', args, isInteractive: true });
		await ctx.runner.text({
			tool: 'cf',
			args: ['auth', 'activate', names.profile, ctx.paths.root]
		});
		identity = await ctx.cf.whoami();
	}

	if (identity.scopes === null) {
		ctx.report.warn(
			'cf does not report granted scopes, so they cannot be checked; a missing permission will show up as a clear error on the first call that needs it'
		);
	} else {
		assertScopesGranted(requiredScopes(manifest.authMode), identity.scopes);
		const missingTags = missingTagScopes(identity.scopes);
		if (missingTags.length > 0) {
			ctx.report.warn(
				`This sign-in lacks ${missingTags.join(', ')}, so resource tags will be skipped; run \`npm run setup -- --force\` to add them`
			);
		}
	}

	if (manifest.authMode === AUTH_MODES.profile) {
		const account = manifest.account?.id ?? identity.accountIds[0] ?? '';
		let wrangler = ctx.makeWrangler({ kind: 'profile', accountId: account });
		let wranglerIdentity = await wrangler.whoami().catch(() => null);
		if (wranglerIdentity === null) {
			await wrangler.authCreate(names.profile);
			await wrangler.authActivate(names.profile, ctx.paths.root);
			wrangler = ctx.makeWrangler({ kind: 'profile', accountId: account });
			wranglerIdentity = await wrangler.whoami();
		}
		assertSameIdentity(identity, wranglerIdentity);
	}

	return { manifest: ctx.save(withStepDone(manifest, 'sign-in')), identity };
}
