import { resolveTypedConfirmation, type AnswerMode } from './answers.ts';
import type { Asker } from './asker.ts';
import type { StepContext } from './context.ts';
import { ERROR_CODES, SetupError } from './errors.ts';
import { AUTH_MODES, OWNERSHIPS, loadManifest, type Manifest } from './manifest.ts';
import { resourceNames } from './names.ts';
import { RESOURCE_STATES, reconcile, type ResourceKey } from './reconcile.ts';
import { readDeployDefaults } from './steps/name.ts';
import { observe, observeTags } from './steps/reconcile.ts';
import {
	planSubdomainTeardown,
	recoverSubdomainSettings,
	removeSubdomainItem,
	type SubdomainTeardownKey
} from './steps/subdomains.ts';
import { TAGGABLE, untagResource, type TaggableKey } from './tags.ts';

export interface TeardownItem {
	key: ResourceKey | SubdomainTeardownKey;
	name: string;
	/** Data that cannot be recovered; needs its own typed confirmation. */
	isIrreversible: boolean;
	/** A DNS record or route id, for the tree subdomain items. */
	id?: string;
	/** The zone of a tree subdomain record or route. */
	zoneId?: string;
}

function isTaggable(key: TeardownItem['key']): key is TaggableKey {
	return key in TAGGABLE;
}

/**
 * Only what this install provably made: marker keys must read back as this install's UUID, and
 * the rest must have their id in the manifest. Anything `unmarked`, `foreign` or merely
 * name-matched is left alone.
 */
export async function planTeardown(ctx: StepContext, manifest: Manifest): Promise<TeardownItem[]> {
	if (!manifest.account || !manifest.hostname) return [];
	ctx.cf.useAccount(manifest.account.id);
	const names = resourceNames(manifest.workerName);
	const observed = await observe(ctx, manifest, manifest.hostname);
	const observedTags = await observeTags(ctx, manifest, observed, true);
	const result = reconcile({
		manifest,
		names,
		hostname: manifest.hostname,
		observed,
		tags: observedTags.witnesses
	});
	const items: TeardownItem[] = [];
	const isOurs = (key: ResourceKey) => result.reports[key].state === RESOURCE_STATES.ours;
	// The tree subdomains first: the record and routes send traffic to the Worker deleted below. A
	// manifest without them may still have them in D1 (turned off, or a fresh clone).
	const subdomains =
		manifest.subdomains ?? (await recoverSubdomainSettings(ctx, manifest, readDeployDefaults(ctx)));
	if (subdomains) {
		const app = (await ctx.cf.listAccessApps()).find((a) => a.id === manifest.access.app?.id);
		for (const item of await planSubdomainTeardown(
			ctx,
			{ ...manifest, subdomains },
			isOurs('accessApp'),
			app?.destinations ?? []
		))
			items.push({ ...item, isIrreversible: false });
	}
	if (isOurs('accessApp'))
		items.push({ key: 'accessApp', name: result.reports.accessApp.name, isIrreversible: false });
	if (
		manifest.access.policies.some((p) => p.ownership === OWNERSHIPS.owned) &&
		isOurs('accessPolicy')
	) {
		items.push({ key: 'accessPolicy', name: names.accessPolicy, isIrreversible: false });
	}
	if (observed.worker?.markerInstallId === manifest.installId)
		items.push({ key: 'worker', name: names.worker, isIrreversible: false });
	if (isOurs('queue')) items.push({ key: 'queue', name: names.queue, isIrreversible: false });
	if (observed.r2?.markerInstallId === manifest.installId)
		items.push({ key: 'r2', name: names.r2, isIrreversible: true });
	if (observed.d1?.markerInstallId === manifest.installId)
		items.push({ key: 'd1', name: names.d1, isIrreversible: true });
	return items;
}

/**
 * The workerName is typed once for the whole teardown; D1 and R2 each need their own name typed because a
 * family tree cannot be recovered. `--yes` is refused by `resolveTypedConfirmation`. Never part of
 * setup, and setup never rolls back by deleting.
 */
export async function runTeardown(
	ctx: StepContext,
	mode: AnswerMode,
	asker: Asker
): Promise<TeardownItem[]> {
	const manifest = loadManifest(ctx.fs, ctx.paths.manifestFile);
	if (!manifest) throw new SetupError(ERROR_CODES.manifest, 'There is no install in this checkout');
	const items = await planTeardown(ctx, manifest);
	if (items.length === 0) return [];

	if (resolveTypedConfirmation(manifest.workerName, undefined, mode) === 'ask') {
		ctx.report.info(`Will delete: ${items.map((i) => i.name).join(', ')}`);
		await asker.text({
			message: `Type the workerName "${manifest.workerName}" to continue`,
			validate: (v) =>
				v.trim() === manifest.workerName ? undefined : `Type exactly ${manifest.workerName}`
		});
	}
	for (const item of items.filter((i) => i.isIrreversible)) {
		if (resolveTypedConfirmation(item.name, undefined, mode) === 'ask') {
			await asker.text({
				message: `${item.name} holds data that cannot be recovered. Type its name to delete it`,
				validate: (v) => (v.trim() === item.name ? undefined : `Type exactly ${item.name}`)
			});
		}
	}

	const wrangler = ctx.makeWrangler(
		manifest.authMode === AUTH_MODES.envToken
			? {
					kind: 'token',
					token: ctx.env.CLOUDFLARE_API_TOKEN ?? '',
					accountId: manifest.account?.id ?? ''
				}
			: { kind: 'profile', accountId: manifest.account?.id ?? '' }
	);
	const accessApp = manifest.access.app;
	const owned = manifest.access.policies.find((p) => p.ownership === OWNERSHIPS.owned);
	// Dependents first: the application before the policy it uses, the Worker before its queue and storage.
	for (const item of items) {
		// Tags first: a tag outliving its resource would be inherited by a re-created bucket of the same name.
		if (isTaggable(item.key)) await untagResource(ctx, manifest, item.key);
		if (
			item.key === 'dnsRecord' ||
			item.key === 'treeRoute' ||
			item.key === 'exclusionRoute' ||
			item.key === 'accessDestination'
		)
			await removeSubdomainItem(ctx, manifest, { ...item, key: item.key });
		if (item.key === 'accessApp' && accessApp) await ctx.cf.deleteAccessApp(accessApp.id);
		if (item.key === 'accessPolicy' && owned) await ctx.cf.deletePolicy(owned.id);
		if (item.key === 'worker') await wrangler.deleteWorker(item.name);
		if (item.key === 'queue' && manifest.resources.queue)
			await ctx.cf.deleteQueue(manifest.resources.queue.id);
		if (item.key === 'r2') await ctx.cf.deleteR2Bucket(item.name);
		if (item.key === 'd1' && manifest.resources.d1) await ctx.cf.deleteD1(manifest.resources.d1.id);
	}
	return items;
}
