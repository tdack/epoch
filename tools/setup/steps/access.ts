import type { StepContext } from '../context.ts';
import { ERROR_CODES, SetupError } from '../errors.ts';
import { OWNERSHIPS, withStepDone, type Manifest, type PolicyRef } from '../manifest.ts';
import { resourceNames } from '../names.ts';
import type { Answers } from '../options.ts';
import { ownerOnlyRules } from '../policy.ts';
import { TAG_STATES, tagResources } from '../tags.ts';

/** The Access destination that puts the sign-in in front of every tree subdomain (ADR-057). */
export function treeLoginDestination(zone: string): string {
	return `*.${zone}/login`;
}

/**
 * The whole application, as both this step and `./setup subdomains` send it. An update replaces
 * the application, so each must carry the other's destinations or a re-run would drop them.
 */
export function accessAppBody(
	manifest: Manifest,
	hostname: string,
	policyIds: string[],
	idpIds: string[]
) {
	return {
		name: manifest.access.app?.name ?? resourceNames(manifest.workerName).accessApp,
		domain: `${hostname}/login`,
		// Undefined, not empty, without subdomains: the body stays as it was before ADR-057.
		extraDestinations: manifest.subdomains
			? [treeLoginDestination(manifest.subdomains.zone.name)]
			: undefined,
		policyIds,
		idpIds,
		// With exactly one provider there is nothing to choose, so skip the picker.
		isAutoRedirect: idpIds.length === 1
	};
}

/**
 * One Access application on `<host>/login` and its policies; nothing else in Zero Trust is read for
 * writing, and updates go by the id in the manifest, never by name. Done before the deploy so the
 * Worker never serves the host without Access in front of `/login`.
 */
export async function access(
	ctx: StepContext,
	manifest: Manifest,
	answers: Answers
): Promise<Manifest> {
	const names = resourceNames(manifest.workerName);
	let current = manifest;

	// Referenced policies are attached as they are. They stay `referenced` in the manifest so
	// `allow` and `disallow` refuse them.
	const refs: PolicyRef[] = [];
	const known = await ctx.cf.listPolicies();
	for (const id of answers.policy.existingIds) {
		const policy = known.find((p) => p.id === id);
		if (!policy)
			throw new SetupError(ERROR_CODES.prerequisite, `The Access policy ${id} no longer exists`);
		refs.push({ id, name: policy.name, ownership: OWNERSHIPS.referenced });
	}
	if (answers.policy.isNewPolicy) {
		const owned = current.access.policies.find((p) => p.ownership === OWNERSHIPS.owned);
		if (owned && known.some((p) => p.id === owned.id)) {
			refs.push(owned);
		} else {
			const sameName = known.find((p) => p.name === names.accessPolicy);
			if (sameName) {
				// Not created by us, so referenced and never edited even though the name matches.
				refs.push({ id: sameName.id, name: sameName.name, ownership: OWNERSHIPS.referenced });
			} else {
				const created = await ctx.cf.createPolicy(
					names.accessPolicy,
					ownerOnlyRules(answers.ownerEmail)
				);
				refs.push({ id: created.id, name: created.name, ownership: OWNERSHIPS.owned });
			}
		}
		current = ctx.save({ ...current, access: { ...current.access, policies: refs } });
	} else {
		current = ctx.save({ ...current, access: { ...current.access, policies: refs } });
	}

	const body = accessAppBody(
		current,
		answers.hostname,
		refs.map((ref) => ref.id),
		answers.idpIds
	);
	const app = current.access.app
		? await ctx.cf.updateAccessApp(current.access.app.id, body)
		: await ctx.cf.createAccessApp(body);
	if (!app.aud) {
		// SPIKE: the create response should carry `aud`. Without it the deployed AUD check cannot work.
		throw new SetupError(
			ERROR_CODES.command,
			'Access created the application but returned no AUD tag',
			{
				hint: 'Copy the AUD from Zero Trust → Access → Applications and re-run.'
			}
		);
	}
	current = ctx.save({
		...current,
		access: {
			...current.access,
			idps: answers.idpIds,
			app: { id: app.id, name: app.name, aud: app.aud }
		}
	});
	current = await tagResources(ctx, current, ['accessApp'], TAG_STATES.provisioning);
	return ctx.save(withStepDone(current, 'access'));
}
