import type { DnsRecord, ZoneRoute } from './cloudflare.ts';
import type { StepContext } from './context.ts';
import { treeHostRoute } from './deploy-values.ts';
import { ERROR_CODES, SetupError } from './errors.ts';
import { isExportOnlyRule, reservedRisk } from './lifecycle.ts';
import { OWNERSHIPS, loadManifest, type Manifest, type SubdomainSettings } from './manifest.ts';
import { resourceNames } from './names.ts';
import { RESOURCE_KEYS, RESOURCE_STATES, reconcile } from './reconcile.ts';
import { treeLoginDestination } from './steps/access.ts';
import { observe, observeTags } from './steps/reconcile.ts';
import { dnsMarker } from './steps/subdomains.ts';
import { TAGGABLE, TAGGABLE_KEYS, TAG_AVAILABILITY, TAG_STATES } from './tags.ts';
import { CHECK_STATUSES, verify, type CheckResult } from './steps/verify.ts';

export const FINDING_LEVELS = { ok: 'ok', warn: 'warn', fail: 'fail' } as const;
type FindingLevel = (typeof FINDING_LEVELS)[keyof typeof FINDING_LEVELS];

export interface Finding {
	level: FindingLevel;
	text: string;
}

/**
 * Re-runs the prerequisite and sign-in checks, reconcile and verify, then reports drift. It is
 * read-only: it names what changed and never repairs it, because a repair is a `setup` run with
 * the user's eyes on the plan.
 */
export async function runDoctor(
	ctx: StepContext
): Promise<{ findings: Finding[]; manifest: Manifest }> {
	const manifest = loadManifest(ctx.fs, ctx.paths.manifestFile);
	if (!manifest || !manifest.account || !manifest.hostname) {
		throw new SetupError(
			ERROR_CODES.manifest,
			'There is no completed install in this checkout to check',
			{
				hint: 'Run `./setup` first. If the install exists but the manifest is lost, setup re-attaches to it.'
			}
		);
	}
	const findings: Finding[] = [];
	const add = (level: FindingLevel, text: string) => findings.push({ level, text });
	const names = resourceNames(manifest.workerName);

	try {
		const identity = await ctx.cf.whoami();
		add(FINDING_LEVELS.ok, `Signed in as ${identity.email ?? 'unknown'}`);
	} catch {
		add(FINDING_LEVELS.fail, 'Not signed in to cf; run `./setup --force` to sign in again');
		return { findings, manifest };
	}
	ctx.cf.useAccount(manifest.account.id);

	add(
		(await ctx.cf.getTeamDomain()) ? FINDING_LEVELS.ok : FINDING_LEVELS.fail,
		'Zero Trust organisation exists'
	);
	add(
		(await ctx.cf.listIdentityProviders()).length > 0 ? FINDING_LEVELS.ok : FINDING_LEVELS.fail,
		'An identity provider exists'
	);
	if (manifest.hosting === 'workers-dev') {
		const subdomain = await ctx.cf.getWorkersSubdomain();
		add(
			subdomain ? FINDING_LEVELS.ok : FINDING_LEVELS.fail,
			'The account has a workers.dev subdomain'
		);
	} else {
		const zones = await ctx.cf.listActiveZones();
		add(
			zones.some((z) => z.id === manifest.zone?.id) ? FINDING_LEVELS.ok : FINDING_LEVELS.fail,
			`Zone ${manifest.zone?.name ?? ''} is active`
		);
	}

	const observed = await observe(ctx, manifest, manifest.hostname);
	const observedTags = await observeTags(ctx, manifest, observed, true);
	const result = reconcile({
		manifest,
		names,
		hostname: manifest.hostname,
		observed,
		tags: observedTags.witnesses
	});
	for (const key of RESOURCE_KEYS) {
		const entry = result.reports[key];
		if (
			key === 'accessPolicy' &&
			!manifest.access.policies.some((p) => p.ownership === OWNERSHIPS.owned)
		)
			continue;
		add(
			entry.state === RESOURCE_STATES.ours ? FINDING_LEVELS.ok : FINDING_LEVELS.fail,
			`${entry.name}: ${entry.state} (${entry.reason})`
		);
	}
	for (const warning of result.warnings) add(FINDING_LEVELS.warn, warning);

	// Tags are a second witness, so their drift is a warning: nothing here is wrong with the install itself.
	if (observedTags.availability === TAG_AVAILABILITY.unavailable) {
		add(
			FINDING_LEVELS.warn,
			'Resource tags are unavailable; this install is checked by its markers alone'
		);
	} else {
		for (const stale of observedTags.stale) {
			add(
				FINDING_LEVELS.warn,
				`Stale tags on ${stale.type} ${stale.id}: the resource no longer exists`
			);
		}
		for (const key of TAGGABLE_KEYS) {
			if (!observed[key]) continue;
			const witness = observedTags.witnesses?.[key];
			if (!witness) {
				add(FINDING_LEVELS.warn, `${TAGGABLE[key].role} has no tags; run \`./setup\` to add them`);
			} else if (witness.state !== TAG_STATES.configured) {
				add(
					FINDING_LEVELS.warn,
					`${TAGGABLE[key].role} is tagged ${witness.state ?? 'without a state'}: an earlier run did not finish`
				);
			}
		}
	}

	// The export lifecycle rule is what expires finished exports. A missing or wider rule means they
	// pile up in the bucket; a destructive rule that could expire live media is worse, and is named
	// on its own line rather than folded into the one below.
	const lifecycleRules = await ctx.cf.getR2Lifecycle(names.r2);
	for (const rule of lifecycleRules) {
		const risk = reservedRisk(rule);
		if (!risk) continue;
		const label = rule.id ? `"${rule.id}"` : `with prefix "${rule.conditions?.prefix ?? ''}"`;
		add(FINDING_LEVELS.fail, `R2 lifecycle rule ${label} is unsafe: ${risk}`);
	}
	add(
		lifecycleRules.some((rule) => isExportOnlyRule(rule)) ? FINDING_LEVELS.ok : FINDING_LEVELS.fail,
		'R2 bucket has an exports/-scoped lifecycle rule that expires after a day'
	);

	// Drift in the two cookie settings ADR-026 depends on, which are easy to change in the dashboard.
	const app = (await ctx.cf.listAccessApps()).find((a) => a.id === manifest.access.app?.id);
	if (app) {
		add(
			app.isPathCookieAttributeOn === false ? FINDING_LEVELS.ok : FINDING_LEVELS.fail,
			'Access application: Cookie Path Attribute is off'
		);
		add(
			app.isBindingCookieOn === false ? FINDING_LEVELS.ok : FINDING_LEVELS.fail,
			'Access application: Binding Cookie is off'
		);
	}
	if (manifest.subdomains) {
		const zoneId = manifest.subdomains.zone.id;
		const [records, routes] = await Promise.all([
			ctx.cf.listDnsRecords(zoneId),
			ctx.cf.listZoneRoutes(zoneId)
		]);
		for (const finding of subdomainFindings({
			installId: manifest.installId,
			workerName: manifest.workerName,
			settings: manifest.subdomains,
			records,
			routes,
			accessDestinations: app?.destinations ?? null
		}))
			findings.push(finding);
	}
	// Referenced policies belong to someone else and may have been deleted or turned into Block.
	const policies = await ctx.cf.listPolicies();
	for (const ref of manifest.access.policies) {
		const live = policies.find((p) => p.id === ref.id);
		if (!live) add(FINDING_LEVELS.fail, `Policy "${ref.name}" no longer exists`);
		else if (live.decision !== 'allow')
			add(FINDING_LEVELS.fail, `Policy "${ref.name}" is now ${live.decision}, so it admits nobody`);
	}

	const verified: CheckResult[] = (await verify(ctx, manifest)).results;
	for (const check of verified) {
		add(
			check.status === CHECK_STATUSES.fail ? FINDING_LEVELS.fail : FINDING_LEVELS.ok,
			`${check.name}: ${check.detail}`
		);
	}
	return { findings, manifest };
}

interface SubdomainObservation {
	installId: string;
	workerName: string;
	settings: SubdomainSettings;
	records: DnsRecord[];
	routes: ZoneRoute[];
	/** Null when the install's Access application is gone; reconcile already reports that. */
	accessDestinations: string[] | null;
}

/**
 * Drift in what `./setup subdomains` made (ADR-057): the wildcard record, the wildcard Worker route,
 * the exclusion routes and the Access destination. Each is easy to change in the dashboard, and a
 * missing one fails quietly: trees stop resolving, or the wildcard takes a hostname it should not.
 */
export function subdomainFindings(observation: SubdomainObservation): Finding[] {
	const { installId, workerName, settings, records, routes, accessDestinations } = observation;
	const zone = settings.zone.name;
	if (!settings.isActive) {
		return [
			{
				level: FINDING_LEVELS.warn,
				text: `Tree subdomains on ${zone} are off, or a run stopped part-way; \`./setup subdomains\` turns them on`
			}
		];
	}
	const findings: Finding[] = [];
	const add = (level: Finding['level'], text: string) => findings.push({ level, text });

	const record = records.find((r) => r.id === settings.dnsRecordId);
	if (!record) {
		add(FINDING_LEVELS.fail, `DNS record *.${zone} is gone, so no tree subdomain resolves`);
	} else {
		add(
			record.isProxied ? FINDING_LEVELS.ok : FINDING_LEVELS.fail,
			`DNS record *.${zone} is proxied`
		);
		// Teardown deletes the record by its id, so a lost marker only weakens re-attaching a fresh clone.
		if (record.comment !== dnsMarker(installId))
			add(FINDING_LEVELS.warn, `DNS record *.${zone} has lost its ${dnsMarker(installId)} comment`);
	}

	const { pattern } = treeHostRoute(zone);
	const wildcard = routes.find((r) => r.pattern === pattern);
	if (!wildcard) {
		add(FINDING_LEVELS.fail, `Worker route ${pattern} is missing; \`npm run deploy\` adds it`);
	} else {
		add(
			wildcard.script === workerName ? FINDING_LEVELS.ok : FINDING_LEVELS.fail,
			`Worker route ${pattern} sends trees to ${workerName}${wildcard.script === workerName ? '' : ` (it names ${wildcard.script ?? 'no Worker'})`}`
		);
	}

	for (const excluded of settings.exclusionRoutes) {
		const live = routes.find((r) => r.id === excluded.id);
		const host = excluded.pattern.replace(/\/\*$/, '');
		if (!live)
			add(
				FINDING_LEVELS.fail,
				`Exclusion route ${excluded.pattern} is gone, so the wildcard takes ${host}`
			);
		else if (live.script !== null)
			add(
				FINDING_LEVELS.fail,
				`Exclusion route ${excluded.pattern} now sends ${host} to ${live.script}`
			);
	}
	if (settings.exclusionRoutes.length > 0 && !findings.some((f) => f.text.startsWith('Exclusion')))
		add(FINDING_LEVELS.ok, `${settings.exclusionRoutes.length} exclusion route(s) in place`);

	if (accessDestinations !== null) {
		const destination = treeLoginDestination(zone);
		add(
			accessDestinations.includes(destination) ? FINDING_LEVELS.ok : FINDING_LEVELS.fail,
			`Access application protects ${destination}`
		);
	}
	return findings;
}
