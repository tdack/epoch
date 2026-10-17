import { resolveAnswer, type AnswerMode } from '../answers.ts';
import type { Asker } from '../asker.ts';
import type { DnsRecord, WorkerDomain, ZoneInfo, ZoneRoute } from '../cloudflare.ts';
import type { StepContext } from '../context.ts';
import type { DeployDefaults } from '../deploy-config.ts';
import { treeHostRoute } from '../deploy-values.ts';
import { ERROR_CODES, SetupError } from '../errors.ts';
import {
	OWNERSHIPS,
	loadManifest,
	type ExclusionRoute,
	type Manifest,
	type SubdomainSettings
} from '../manifest.ts';
import { resourceNames } from '../names.ts';
import { HOSTINGS } from '../options.ts';
import { missingSubdomainScopes } from '../scopes.ts';
import { accessAppBody, treeLoginDestination } from './access.ts';
import { configureBuilds } from './builds.ts';
import { PLAN_SYMBOLS, type PlanLine } from './plan.ts';
import { writeConfig } from './write-config.ts';

/**
 * `./setup subdomains` (ADR-057, proposal "Option A"): serve trees on `<slug>.<zone>`. Setup makes
 * the proxied `*` record, the Worker-less exclusion routes and the Access destination; the
 * wildcard Worker route and the vars go in the deploy config, so `wrangler deploy` owns the route
 * and every Workers Builds deploy keeps it.
 */

/** Proxied to nowhere: the wildcard route sends the request to the Worker before any origin is asked. */
const WILDCARD_RECORD = { type: 'AAAA', content: '100::' } as const;

/** DNS records have no account tags, and their own tags need a paid plan; a comment works on any. */
export function dnsMarker(installId: string): string {
	return `epoch:${installId}`;
}

/** The record types a proxied hostname can have, so the only ones the wildcard route could capture. */
const ADDRESS_TYPES: readonly string[] = ['A', 'AAAA', 'CNAME'];

export interface ZoneSurvey {
	/**
	 * Proxied hostnames that the wildcard route would take from whatever serves them now, including
	 * any that already have an exclusion route: the plan keeps those rather than making a second.
	 */
	captured: string[];
	/** Hostnames another Worker already routes on their own; that route wins over the wildcard. */
	covered: string[];
	/** The label under the zone of every explicit name: a tree there would never reach the Worker. */
	reservedLabels: string[];
	/** An address record at `*.<zone>` already, ours or not. */
	wildcard: DnsRecord | null;
}

function labelUnder(host: string, zone: string): string | null {
	if (!host.endsWith(`.${zone}`)) return null;
	return (
		host
			.slice(0, -zone.length - 1)
			.split('.')
			.pop() ?? null
	);
}

const sorted = (values: Iterable<string>) => [...new Set(values)].sort();

/**
 * Pure. The install's own hostname is left out of both lists: an exclusion route there would take
 * the app off its own Worker, and the app reserves its own label from `EPOCH_APP_HOST`.
 */
export function surveyZone(input: {
	zone: string;
	records: DnsRecord[];
	routes: ZoneRoute[];
	domains: WorkerDomain[];
	ownWorker: string;
	ownHostname: string;
}): ZoneSurvey {
	const { zone, ownHostname } = input;
	const wildcardName = `*.${zone}`;
	const named = [
		...input.records.map((r) => r.name),
		...input.domains.map((d) => d.hostname)
	].filter((host) => host !== wildcardName && host !== ownHostname);
	const reservedLabels = sorted(
		named.map((host) => labelUnder(host, zone)).filter((label) => label !== null)
	);

	const proxied = [
		...input.records
			.filter((r) => r.isProxied && ADDRESS_TYPES.includes(r.type))
			.map((r) => r.name),
		...input.domains.filter((d) => d.service !== input.ownWorker).map((d) => d.hostname)
	].filter(
		(host) => host !== wildcardName && host !== ownHostname && labelUnder(host, zone) !== null
	);
	// Only a Worker's route for the whole host wins over the wildcard everywhere; one for a path
	// does not. A Worker-less one is an exclusion, so the host still counts as captured, or a re-run
	// would read its own exclusion as "not needed" and delete it.
	const isCovered = (host: string) =>
		input.routes.some((r) => r.pattern === `${host}/*` && r.script !== null);
	return {
		captured: sorted(proxied.filter((host) => !isCovered(host))),
		covered: sorted(proxied.filter(isCovered)),
		reservedLabels,
		wildcard:
			input.records.find((r) => r.name === wildcardName && ADDRESS_TYPES.includes(r.type)) ?? null
	};
}

export interface SubdomainOptions {
	/** `--zone`: id or name. */
	zone?: string;
	/** `--reserve`: labels to reserve beyond the ones the zone's records give. */
	reserve?: string[];
}

/** What applying would do, worked out read-only. */
export interface SubdomainPlan {
	settings: SubdomainSettings;
	survey: ZoneSurvey;
	/** Hostname patterns to add an exclusion route for. */
	routesToCreate: string[];
	/** Exclusion routes this install made for a hostname that no longer needs one. */
	routesToDelete: ExclusionRoute[];
	isRecordCreated: boolean;
	isDestinationAdded: boolean;
	lines: PlanLine[];
}

const ZONE_CHOICES = { exclude: 'exclude', otherZone: 'other-zone', stop: 'stop' } as const;
type ZoneChoice = (typeof ZONE_CHOICES)[keyof typeof ZONE_CHOICES];

function requireInstall(manifest: Manifest | null): Manifest & {
	account: { id: string; name: string };
	hostname: string;
	access: Manifest['access'] & { app: { id: string; name: string; aud: string } };
} {
	if (!manifest?.account || !manifest.hostname || !manifest.access.app) {
		throw new SetupError(ERROR_CODES.manifest, 'There is no finished install in this checkout', {
			hint: 'Run `./setup` first.'
		});
	}
	if (manifest.hosting !== HOSTINGS.custom) {
		throw new SetupError(
			ERROR_CODES.prerequisite,
			'Tree subdomains need the install on a custom domain, and this one is on workers.dev only',
			{ hint: 'Move it first: `./setup --hosting custom --zone <zone> --keep-workers-dev`.' }
		);
	}
	return manifest as ReturnType<typeof requireInstall>;
}

async function assertScopes(ctx: StepContext): Promise<void> {
	const identity = await ctx.cf.whoami();
	// An API token reports no scopes; its own permissions decide, and a missing one fails loudly.
	const missing = identity.scopes === null ? [] : missingSubdomainScopes(identity.scopes);
	if (missing.length === 0) return;
	throw new SetupError(
		ERROR_CODES.scopesMissing,
		`The sign-in did not grant ${missing.join(' and ')}, which tree subdomains need`,
		{
			hint: 'Nothing was changed. Run `./setup --force` to sign in again with every permission ticked, then re-run `./setup subdomains`.'
		}
	);
}

async function chooseZone(
	zones: ZoneInfo[],
	preferred: string | undefined,
	fallback: { id: string; name: string } | null,
	mode: AnswerMode,
	asker: Asker
): Promise<ZoneInfo> {
	const byFlag = preferred ? zones.find((z) => z.id === preferred || z.name === preferred) : null;
	if (preferred && !byFlag) {
		throw new SetupError(ERROR_CODES.usage, `No active zone "${preferred}" in this account`, {
			flag: '--zone'
		});
	}
	const current = fallback ? zones.find((z) => z.id === fallback.id) : undefined;
	const resolution = resolveAnswer(
		{
			flag: '--zone',
			flagValue: byFlag ?? undefined,
			onlyChoice: zones.length === 1 ? zones[0] : undefined,
			defaultValue: current
		},
		mode
	);
	if (resolution.status === 'answered') return resolution.value;
	return asker.select({
		message: 'Which zone should trees be served under?',
		choices: zones.map((z) => ({ value: z, label: z.name })),
		initial: current
	});
}

async function chooseCaptureAnswer(
	survey: ZoneSurvey,
	mode: AnswerMode,
	asker: Asker
): Promise<ZoneChoice> {
	if (survey.captured.length === 0) return ZONE_CHOICES.exclude;
	const resolution = resolveAnswer(
		{ flag: '--yes', flagValue: undefined, defaultValue: ZONE_CHOICES.exclude },
		mode
	);
	if (resolution.status === 'answered') return resolution.value;
	return asker.select<ZoneChoice>({
		message: 'The wildcard route would take these hostnames from what serves them now',
		choices: [
			{
				value: ZONE_CHOICES.exclude,
				label: 'Add a route with no Worker for each, and reserve their labels'
			},
			{ value: ZONE_CHOICES.otherZone, label: 'Use a different zone' },
			{ value: ZONE_CHOICES.stop, label: 'Stop; change nothing' }
		],
		initial: ZONE_CHOICES.exclude
	});
}

/** Read-only: what the zone holds, what the wildcard would capture, and what applying would change. */
export async function planSubdomains(
	ctx: StepContext,
	manifest: Manifest,
	options: SubdomainOptions,
	mode: AnswerMode,
	asker: Asker
): Promise<SubdomainPlan> {
	const install = requireInstall(manifest);
	ctx.cf.useAccount(install.account.id);
	await assertScopes(ctx);
	const zones = await ctx.cf.listActiveZones();
	const ownWorker = resourceNames(install.workerName).worker;

	let preferred = options.zone;
	let fallback = install.subdomains?.zone ?? install.zone;
	for (;;) {
		const zone = await chooseZone(zones, preferred, fallback, mode, asker);
		const [records, routes, domains] = await Promise.all([
			ctx.cf.listDnsRecords(zone.id),
			ctx.cf.listZoneRoutes(zone.id),
			ctx.cf.listWorkerDomains(zone.id)
		]);
		const survey = surveyZone({
			zone: zone.name,
			records,
			routes,
			domains,
			ownWorker,
			ownHostname: install.hostname
		});
		reportSurvey(ctx, zone.name, survey);
		const choice = await chooseCaptureAnswer(survey, mode, asker);
		if (choice === ZONE_CHOICES.stop)
			throw new SetupError(ERROR_CODES.cancelled, 'Nothing was changed');
		if (choice === ZONE_CHOICES.otherZone) {
			// The flag named the zone just refused, so the next pick must be a prompt.
			preferred = undefined;
			fallback = null;
			continue;
		}
		return buildSubdomainPlan(install, zone, survey, routes, options);
	}
}

function reportSurvey(ctx: StepContext, zone: string, survey: ZoneSurvey): void {
	ctx.report.info(
		survey.captured.length === 0
			? `No proxied hostname on ${zone} would be taken by the wildcard route.`
			: `The wildcard route *.${zone}/* would take, unless excluded: ${survey.captured.join(', ')}`
	);
	if (survey.covered.length > 0)
		ctx.report.info(`Already routed on their own, so not taken: ${survey.covered.join(', ')}`);
}

function buildSubdomainPlan(
	install: ReturnType<typeof requireInstall>,
	zone: ZoneInfo,
	survey: ZoneSurvey,
	routes: ZoneRoute[],
	options: SubdomainOptions
): SubdomainPlan {
	const previous = install.subdomains?.zone.id === zone.id ? install.subdomains : null;
	const marker = dnsMarker(install.installId);
	if (
		survey.wildcard &&
		survey.wildcard.comment !== marker &&
		survey.wildcard.id !== previous?.dnsRecordId
	) {
		throw new SetupError(
			ERROR_CODES.foreign,
			`${zone.name} already has a ${survey.wildcard.type} record for *.${zone.name} that this install did not make`,
			{
				hint: 'Setup will not replace it. Remove it, or choose another zone with --zone.'
			}
		);
	}

	const wantedPatterns = survey.captured.map((host) => `${host}/*`);
	const isExclusion = (r: ZoneRoute) => r.script === null;
	const kept: ExclusionRoute[] = [];
	for (const pattern of wantedPatterns) {
		const existing = routes.find((r) => r.pattern === pattern && isExclusion(r));
		if (!existing) continue;
		const ours = previous?.exclusionRoutes.find((r) => r.id === existing.id);
		// One made by hand, or by a checkout whose manifest is gone, is kept but never deleted.
		kept.push(ours ?? { id: existing.id, pattern, ownership: OWNERSHIPS.referenced });
	}
	const routesToCreate = wantedPatterns.filter((p) => !kept.some((r) => r.pattern === p));
	const routesToDelete = (previous?.exclusionRoutes ?? []).filter(
		(r) =>
			r.ownership === OWNERSHIPS.owned &&
			!kept.some((k) => k.id === r.id) &&
			routes.some((live) => live.id === r.id && isExclusion(live))
	);

	const reservedLabels = sorted([
		...survey.reservedLabels,
		...(options.reserve ?? []).map((label) => label.trim().toLowerCase()).filter(Boolean),
		...(previous?.reservedLabels ?? [])
	]);
	const hostname = install.hostname;
	const settings: SubdomainSettings = {
		zone: { id: zone.id, name: zone.name },
		reservedLabels,
		appHost: hostname === zone.name ? null : hostname,
		dnsRecordId: survey.wildcard?.id ?? null,
		exclusionRoutes: kept
	};
	const isRecordCreated = survey.wildcard === null;
	const isDestinationAdded = previous === null;

	const lines: PlanLine[] = [
		isRecordCreated
			? {
					symbol: PLAN_SYMBOLS.create,
					text: `create the proxied DNS record * ${WILDCARD_RECORD.type} ${WILDCARD_RECORD.content} on ${zone.name}`
				}
			: { symbol: PLAN_SYMBOLS.unchanged, text: `DNS record *.${zone.name} (already ours)` },
		...routesToCreate.map((pattern) => ({
			symbol: PLAN_SYMBOLS.create,
			text: `create the route ${pattern} with no Worker`
		})),
		...kept.map((r) => ({
			symbol: r.ownership === OWNERSHIPS.owned ? PLAN_SYMBOLS.unchanged : PLAN_SYMBOLS.reference,
			text: `route ${r.pattern} with no Worker (${r.ownership === OWNERSHIPS.owned ? 'already ours' : 'already there; kept, never deleted'})`
		})),
		...routesToDelete.map((r) => ({
			symbol: PLAN_SYMBOLS.remove,
			text: `delete the route ${r.pattern}: nothing proxied there any more`
		})),
		{
			symbol: PLAN_SYMBOLS.adopt,
			text: `sign-in on ${treeLoginDestination(zone.name)}, added to the Access application ${install.access.app.name} (same AUD)`
		},
		{
			symbol: PLAN_SYMBOLS.adopt,
			text: `wrangler.deploy.jsonc: route ${treeHostRoute(zone.name).pattern}, EPOCH_TREE_HOST_ZONE=${zone.name}${reservedLabels.length > 0 ? `, EPOCH_RESERVED_SUBDOMAINS=${reservedLabels.join(',')}` : ''}${settings.appHost ? `, EPOCH_APP_HOST=${settings.appHost}` : ''}`
		}
	];
	return {
		settings,
		survey,
		routesToCreate,
		routesToDelete,
		isRecordCreated,
		isDestinationAdded,
		lines
	};
}

/**
 * Exclusion routes first, so no hostname is ever captured before its exclusion exists, then the
 * record and the Access destination. The manifest is saved after each, so a failure part-way
 * leaves a record of what exists for the re-run to find.
 */
async function applySubdomains(
	ctx: StepContext,
	manifest: Manifest,
	plan: SubdomainPlan
): Promise<{ manifest: Manifest; lines: string[] }> {
	const install = requireInstall(manifest);
	const zoneId = plan.settings.zone.id;
	let settings = plan.settings;
	let current: Manifest = ctx.save({ ...install, subdomains: settings });

	for (const pattern of plan.routesToCreate) {
		const route = await ctx.cf.createExclusionRoute(zoneId, pattern);
		settings = {
			...settings,
			exclusionRoutes: [
				...settings.exclusionRoutes,
				{ id: route.id, pattern, ownership: OWNERSHIPS.owned }
			]
		};
		current = ctx.save({ ...current, subdomains: settings });
	}
	for (const route of plan.routesToDelete) await ctx.cf.deleteZoneRoute(zoneId, route.id);

	if (plan.isRecordCreated) {
		const record = await ctx.cf.createDnsRecord(zoneId, {
			...WILDCARD_RECORD,
			name: `*.${plan.settings.zone.name}`,
			isProxied: true,
			comment: dnsMarker(install.installId)
		});
		settings = { ...settings, dnsRecordId: record.id };
		current = ctx.save({ ...current, subdomains: settings });
	}

	const app = install.access.app;
	const updated = await ctx.cf.updateAccessApp(
		app.id,
		accessAppBody(
			current,
			install.hostname,
			install.access.policies.map((p) => p.id),
			install.access.idps
		)
	);
	if (updated.aud && updated.aud !== app.aud) {
		throw new SetupError(
			ERROR_CODES.command,
			`The Access application's AUD changed from ${app.aud} to ${updated.aud}`,
			{ hint: 'Re-run `./setup` so the deployed Worker checks the new one.' }
		);
	}
	const destination = treeLoginDestination(plan.settings.zone.name);
	if (!updated.destinations.includes(destination)) {
		ctx.report.warn(
			`Access did not report ${destination} on ${app.name}; add it as a public destination in Zero Trust → Access → Applications`
		);
	}

	current = await writeConfig(ctx, current);
	const builds = await configureBuilds(ctx, current);
	return {
		manifest: current,
		lines: [
			`Trees can now be served on <slug>.${plan.settings.zone.name}, once deployed: run \`npm run deploy\` (a push deploys only when src/ changes).`,
			'Then turn a tree’s subdomain on from its rename dialog.',
			...builds
		]
	};
}

/** What the command shows and asks between the read-only plan and the changes. */
interface SubdomainPresenter {
	showPlan(lines: PlanLine[]): void;
	showHandOff(lines: string[]): void;
}

export async function runSubdomains(
	ctx: StepContext,
	options: SubdomainOptions & { isPlanOnly: boolean },
	mode: AnswerMode,
	asker: Asker,
	presenter: SubdomainPresenter
): Promise<{ plan: PlanLine[]; isApplied: boolean; manifest: Manifest | null }> {
	const manifest = requireInstall(loadManifest(ctx.fs, ctx.paths.manifestFile));
	const plan = await planSubdomains(ctx, manifest, options, mode, asker);
	presenter.showPlan(plan.lines);
	if (options.isPlanOnly) return { plan: plan.lines, isApplied: false, manifest: null };
	if (!mode.isYes) {
		if (!mode.isInteractive) {
			throw new SetupError(
				ERROR_CODES.missingAnswer,
				'Applying the plan needs confirmation, and there is no terminal to ask on',
				{ flag: '--yes', hint: 'Pass --yes to apply the plan above, or --plan to stop here.' }
			);
		}
		if (!(await asker.confirm({ message: 'Apply this plan?', isInitiallyYes: false }))) {
			throw new SetupError(ERROR_CODES.cancelled, 'Nothing was changed');
		}
	}
	const applied = await applySubdomains(ctx, manifest, plan);
	presenter.showHandOff(applied.lines);
	return { plan: plan.lines, isApplied: true, manifest: applied.manifest };
}

/**
 * A fresh clone has no manifest settings, only the vars in `wrangler.deploy.jsonc`. Without this a
 * re-run of `./setup` would regenerate the file without them and drop every tree subdomain. The
 * record and route ids are not in the file; `./setup subdomains` finds them again.
 */
export async function seedSubdomains(
	ctx: StepContext,
	manifest: Manifest,
	defaults: DeployDefaults
): Promise<Manifest> {
	if (manifest.subdomains || !defaults.treeHostZone) return manifest;
	const zone = (await ctx.cf.listActiveZones()).find((z) => z.name === defaults.treeHostZone);
	if (!zone) {
		ctx.report.warn(
			`wrangler.deploy.jsonc serves trees under ${defaults.treeHostZone}, which is not an active zone in this account; the tree subdomains are left out`
		);
		return manifest;
	}
	return ctx.save({
		...manifest,
		subdomains: {
			zone,
			reservedLabels: sorted(defaults.reservedSubdomains),
			appHost: defaults.appHost,
			dnsRecordId: null,
			exclusionRoutes: []
		}
	});
}

/** What teardown removes for the tree subdomains, each proved ours or recorded as made by us. */
export type SubdomainTeardownKey =
	'dnsRecord' | 'exclusionRoute' | 'treeRoute' | 'accessDestination';

export interface SubdomainTeardownItem {
	key: SubdomainTeardownKey;
	name: string;
	/** The record or route id; absent for the Access destination. */
	id?: string;
}

/**
 * Read-only. The record only when its comment carries this install's marker; exclusion routes only
 * when this install made them and they still have no Worker; the wildcard route only when it
 * points at this install's Worker. A listing that fails (a sign-in without `dns.write` can still
 * read) leaves its items out with a warning rather than stopping the teardown.
 */
export async function planSubdomainTeardown(
	ctx: StepContext,
	manifest: Manifest,
	isAccessAppDeleted: boolean,
	accessDestinations: string[]
): Promise<SubdomainTeardownItem[]> {
	const settings = manifest.subdomains;
	if (!settings) return [];
	const zone = settings.zone;
	const items: SubdomainTeardownItem[] = [];
	try {
		const marker = dnsMarker(manifest.installId);
		for (const record of await ctx.cf.listDnsRecords(zone.id)) {
			if (record.name === `*.${zone.name}` && record.comment === marker)
				items.push({ key: 'dnsRecord', name: `DNS record *.${zone.name}`, id: record.id });
		}
	} catch (error) {
		ctx.report.warn(`Could not list the DNS records on ${zone.name}: ${(error as Error).message}`);
	}
	try {
		const routes = await ctx.cf.listZoneRoutes(zone.id);
		const worker = resourceNames(manifest.workerName).worker;
		const wildcard = treeHostRoute(zone.name).pattern;
		for (const route of routes) {
			if (route.pattern === wildcard && route.script === worker)
				items.push({ key: 'treeRoute', name: `route ${route.pattern}`, id: route.id });
		}
		for (const owned of settings.exclusionRoutes) {
			const live = routes.find((r) => r.id === owned.id);
			if (
				owned.ownership === OWNERSHIPS.owned &&
				live &&
				live.script === null &&
				live.pattern === owned.pattern
			)
				items.push({ key: 'exclusionRoute', name: `route ${owned.pattern}`, id: owned.id });
		}
	} catch (error) {
		ctx.report.warn(
			`Could not list the Worker routes on ${zone.name}: ${(error as Error).message}`
		);
	}
	const destination = treeLoginDestination(zone.name);
	if (!isAccessAppDeleted && accessDestinations.includes(destination))
		items.push({ key: 'accessDestination', name: `Access destination ${destination}` });
	return items;
}

/** Removes one item `planSubdomainTeardown` returned. */
export async function removeSubdomainItem(
	ctx: StepContext,
	manifest: Manifest,
	item: SubdomainTeardownItem
): Promise<void> {
	const settings = manifest.subdomains;
	if (!settings) return;
	if (item.key === 'dnsRecord' && item.id) await ctx.cf.deleteDnsRecord(settings.zone.id, item.id);
	if ((item.key === 'treeRoute' || item.key === 'exclusionRoute') && item.id)
		await ctx.cf.deleteZoneRoute(settings.zone.id, item.id);
	if (item.key === 'accessDestination' && manifest.access.app && manifest.hostname) {
		// An empty list, not none, so the body names the app host as the only destination left.
		await ctx.cf.updateAccessApp(manifest.access.app.id, {
			...accessAppBody(
				manifest,
				manifest.hostname,
				manifest.access.policies.map((p) => p.id),
				manifest.access.idps
			),
			extraDestinations: []
		});
	}
}
