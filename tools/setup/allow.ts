import type { StepContext } from './context.ts';
import { ERROR_CODES, SetupError } from './errors.ts';
import { loadManifest } from './manifest.ts';
import { assertEmail, editEmailRules, ownedPolicyOf } from './policy.ts';

/**
 * `allow` and `disallow` edit only the policy this tool created. A policy the user picked from
 * the existing ones may protect other applications, so it is never touched.
 */
export async function changeAllowedEmail(
	ctx: StepContext,
	action: 'add' | 'remove',
	rawEmail: string
): Promise<{ policyName: string; email: string }> {
	const email = assertEmail(rawEmail);
	const manifest = loadManifest(ctx.fs, ctx.paths.manifestFile);
	if (!manifest?.account) {
		throw new SetupError(ERROR_CODES.manifest, 'There is no install in this checkout', {
			hint: 'Run `./setup` first.'
		});
	}
	const owned = ownedPolicyOf(manifest);
	ctx.cf.useAccount(manifest.account.id);
	const live = (await ctx.cf.listPolicies()).find((p) => p.id === owned.id);
	if (!live) {
		throw new SetupError(ERROR_CODES.prerequisite, `The policy "${owned.name}" no longer exists`, {
			hint: 'Run `./setup` to recreate it.'
		});
	}
	const include = editEmailRules(live.include, { action, email });
	if (include !== live.include) await ctx.cf.updatePolicy(live, include);
	return { policyName: live.name, email };
}
