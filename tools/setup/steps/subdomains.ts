import { resolveAnswer, type AnswerMode } from '../answers.ts';
import type { Asker } from '../asker.ts';
import type { DnsRecord, WorkerDomain, ZoneInfo, ZoneRoute } from '../cloudflare.ts';
import type { StepContext } from '../context.ts';
import type { DeployDefaults } from '../deploy-config.ts';
import { treeHostRoute } from '../deploy-values.ts';
import { ERROR_CODES, SetupError } from '../errors.ts';
import {
	isMissingColumn,
	isMissingTable,
	parseSubdomainsRows,
	readSubdomainsSql,
	writeSubdomainsSql,
	type InstallSubdomains
} from '../install-meta.ts';
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

/** Leaves room in the 5000-character build variable for every other install value. */
const MAX_RESERVED_LABELS_CHARS = 3500;

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

/**
 * Checks the `cf` sign-in. The route and Custom Domain calls go through the raw API with the
 * wrangler profile's token (app.ts), which this cannot see; a missing permission there fails the
 * call itself, before the record or the Access destination is touched.
 */
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
		if (install.subdomains && install.subdomains.zone.id !== zone.id) {
			// The old zone's record and routes are recorded only here; replacing the settings would leave
			// them where neither a re-run nor teardown looks.
			throw new SetupError(
				ERROR_CODES.usage,
				`This install already serves trees under ${install.subdomains.zone.name}`,
				{
					flag: '--zone',
					hint: `Keep --zone ${install.subdomains.zone.name}, or run \`./setup teardown\` before moving to ${zone.name}.`
				}
			);
		}
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
		return buildSubdomainPlan(ctx, install, zone, survey, routes, options);
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
	ctx: StepContext,
	install: ReturnType<typeof requireInstall>,
	zone: ZoneInfo,
	survey: ZoneSurvey,
	routes: ZoneRoute[],
	options: SubdomainOptions
): SubdomainPlan {
	const previous = install.subdomains;
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
		exclusionRoutes: kept,
		isActive: previous?.isActive ?? false
	};
	if (reservedLabels.join(',').length > MAX_RESERVED_LABELS_CHARS) {
		ctx.report.warn(
			`${reservedLabels.length} reserved labels make a long EPOCH_DEPLOY_VALUES; Workers Builds refuses a variable over 5000 characters`
		);
	}
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

	// Only now may a deploy or a re-run of `./setup` carry the wildcard: every exclusion exists.
	settings = { ...settings, isActive: true };
	current = ctx.save({ ...current, subdomains: settings });

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
	await recordSubdomains(ctx, current);
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

export interface SubdomainRunOptions extends SubdomainOptions {
	isPlanOnly: boolean;
	/** `--off`: stop serving trees on subdomains, keeping the record and exclusion routes. */
	isOff?: boolean;
	/** `--remove`, with `--off` only: delete the record and this install's exclusion routes too. */
	isRemove?: boolean;
}

function assertRunOptions(options: SubdomainRunOptions): void {
	if (options.isRemove && !options.isOff)
		throw new SetupError(ERROR_CODES.usage, '--remove only goes with --off', { flag: '--remove' });
	if (options.isOff && (options.zone || (options.reserve ?? []).length > 0))
		throw new SetupError(ERROR_CODES.usage, '--off takes neither --zone nor --reserve', {
			flag: '--off'
		});
}

async function confirmApply(mode: AnswerMode, asker: Asker): Promise<void> {
	if (mode.isYes) return;
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

export async function runSubdomains(
	ctx: StepContext,
	options: SubdomainRunOptions,
	mode: AnswerMode,
	asker: Asker,
	presenter: SubdomainPresenter
): Promise<{ plan: PlanLine[]; isApplied: boolean; manifest: Manifest | null }> {
	assertRunOptions(options);
	const manifest = requireInstall(loadManifest(ctx.fs, ctx.paths.manifestFile));
	if (options.isOff) {
		const off = await planSubdomainsOff(ctx, manifest, options.isRemove ?? false);
		presenter.showPlan(off.lines);
		if (options.isPlanOnly) return { plan: off.lines, isApplied: false, manifest: null };
		await confirmApply(mode, asker);
		const applied = await applySubdomainsOff(ctx, manifest, off.items, options.isRemove ?? false);
		presenter.showHandOff(applied.lines);
		return { plan: off.lines, isApplied: true, manifest: applied.manifest };
	}
	const plan = await planSubdomains(ctx, manifest, options, mode, asker);
	presenter.showPlan(plan.lines);
	if (options.isPlanOnly) return { plan: plan.lines, isApplied: false, manifest: null };
	await confirmApply(mode, asker);
	const applied = await applySubdomains(ctx, manifest, plan);
	presenter.showHandOff(applied.lines);
	return { plan: plan.lines, isApplied: true, manifest: applied.manifest };
}

/** Teardown items that `--off` removes; `--off --remove` removes every one. */
const OFF_KEYS: readonly SubdomainTeardownKey[] = ['treeRoute', 'accessDestination'];

/** Read-only, like the plan for turning them on. */
async function planSubdomainsOff(
	ctx: StepContext,
	manifest: ReturnType<typeof requireInstall>,
	isRemove: boolean
): Promise<{ items: SubdomainTeardownItem[]; lines: PlanLine[] }> {
	const settings = manifest.subdomains;
	if (!settings)
		throw new SetupError(ERROR_CODES.usage, 'This install does not serve trees on subdomains', {
			flag: '--off'
		});
	ctx.cf.useAccount(manifest.account.id);
	await assertScopes(ctx);
	const app = (await ctx.cf.listAccessApps()).find((a) => a.id === manifest.access.app.id);
	const items = (
		await planSubdomainTeardown(ctx, manifest, app === undefined, app?.destinations ?? [])
	).filter((item) => isRemove || OFF_KEYS.includes(item.key));
	const zone = settings.zone.name;
	const lines: PlanLine[] = [
		{
			symbol: PLAN_SYMBOLS.remove,
			text: `wrangler.deploy.jsonc: route ${treeHostRoute(zone).pattern} and the tree subdomain vars`
		},
		...items.map((item) => ({ symbol: PLAN_SYMBOLS.remove, text: `delete the ${item.name}` }))
	];
	if (!isRemove) {
		const routes = settings.exclusionRoutes.length;
		lines.push({
			symbol: PLAN_SYMBOLS.unchanged,
			text: `DNS record *.${zone} and ${routes} exclusion route(s) kept, so \`./setup subdomains\` turns trees back on`
		});
	}
	return { items, lines };
}

/**
 * The deploy config first, so no deploy started part-way puts the wildcard route back, then the
 * live route and the Access destination, then (with `--remove`) the record and exclusion routes.
 */
async function applySubdomainsOff(
	ctx: StepContext,
	manifest: ReturnType<typeof requireInstall>,
	items: SubdomainTeardownItem[],
	isRemove: boolean
): Promise<{ manifest: Manifest; lines: string[] }> {
	const settings = manifest.subdomains;
	if (!settings)
		throw new SetupError(ERROR_CODES.usage, 'This install does not serve trees on subdomains');
	let current: Manifest = ctx.save({ ...manifest, subdomains: { ...settings, isActive: false } });
	current = await writeConfig(ctx, current);
	const builds = await configureBuilds(ctx, current);
	for (const item of items) await removeSubdomainItem(ctx, current, item);
	if (isRemove) current = ctx.save({ ...current, subdomains: null });
	await recordSubdomains(ctx, current);
	return {
		manifest: current,
		lines: [
			`Trees are no longer served on <slug>.${settings.zone.name}.`,
			'The deployed Worker keeps its tree subdomain vars until the next deploy: run `npm run deploy` (a push deploys only when src/ changes).',
			isRemove
				? '`./setup subdomains` sets them up again from the start.'
				: '`./setup subdomains` turns them back on.',
			...builds
		]
	};
}

/** What this install made, for `install_meta.subdomains`; null once nothing is left. */
function installSubdomainsOf(settings: SubdomainSettings | null): InstallSubdomains | null {
	if (!settings) return null;
	return {
		zone: settings.zone,
		dnsRecordId: settings.dnsRecordId,
		exclusionRouteIds: settings.exclusionRoutes
			.filter((route) => route.ownership === OWNERSHIPS.owned)
			.map((route) => route.id),
		isActive: settings.isActive
	};
}

function isNotMigrated(error: unknown): boolean {
	const message = String((error as Error).message);
	return isMissingColumn(message) || isMissingTable(message);
}

/**
 * Keeps D1 in step with the manifest. A failure warns rather than throws: the changes on the zone
 * are already made and the manifest holds them; only a clone with no manifest would miss them.
 */
async function recordSubdomains(ctx: StepContext, manifest: Manifest): Promise<void> {
	const d1 = manifest.resources.d1;
	if (!d1) return;
	try {
		await ctx.cf.queryD1(
			d1.id,
			writeSubdomainsSql(manifest.installId, installSubdomainsOf(manifest.subdomains))
		);
	} catch (error) {
		ctx.report.warn(
			isNotMigrated(error)
				? `${d1.name} has no install_meta.subdomains yet (migration 0035); run \`npm run db:migrate\`, then \`./setup subdomains\` again so a fresh clone can find what it made`
				: `Could not record the tree subdomains in ${d1.name}: ${(error as Error).message}`
		);
	}
}

async function readRecordedSubdomains(
	ctx: StepContext,
	installId: string,
	d1Id: string | null
): Promise<InstallSubdomains | null> {
	if (!d1Id) return null;
	try {
		return parseSubdomainsRows(await ctx.cf.queryD1(d1Id, readSubdomainsSql(installId)));
	} catch (error) {
		if (!isNotMigrated(error))
			ctx.report.warn(`Could not read the tree subdomains from D1: ${(error as Error).message}`);
		return null;
	}
}

/**
 * Rebuilds the settings for a checkout whose manifest has none: the zone and vars from
 * `wrangler.deploy.jsonc`, and the record and exclusion routes from D1, which is the only place
 * that knows them once the config is silent (after `--off`) or the manifest is gone. A recorded
 * route counts only while it still has no Worker, and it takes its pattern from the live route.
 */
export async function recoverSubdomainSettings(
	ctx: StepContext,
	manifest: Manifest,
	defaults: DeployDefaults
): Promise<SubdomainSettings | null> {
	const recorded = await readRecordedSubdomains(
		ctx,
		manifest.installId,
		manifest.resources.d1?.id ?? defaults.d1Id
	);
	if (!defaults.treeHostZone && !recorded) return null;
	let zone: ZoneInfo | undefined = recorded?.zone;
	if (defaults.treeHostZone) {
		zone = (await ctx.cf.listActiveZones()).find((z) => z.name === defaults.treeHostZone);
		if (!zone) {
			ctx.report.warn(
				`wrangler.deploy.jsonc serves trees under ${defaults.treeHostZone}, which is not an active zone in this account; the tree subdomains are left out`
			);
			return null;
		}
	}
	if (!zone) return null;
	// A record for another zone than the config names describes something this checkout cannot see.
	const isRecordedHere = recorded !== null && recorded.zone.id === zone.id;
	const recordedIds = new Set(isRecordedHere ? recorded.exclusionRouteIds : []);
	const exclusionRoutes: ExclusionRoute[] =
		recordedIds.size === 0
			? []
			: (await ctx.cf.listZoneRoutes(zone.id))
					.filter((route) => recordedIds.has(route.id) && route.script === null)
					.map((route) => ({ id: route.id, pattern: route.pattern, ownership: OWNERSHIPS.owned }));
	return {
		zone: { id: zone.id, name: zone.name },
		reservedLabels: sorted(defaults.reservedSubdomains),
		appHost: defaults.appHost,
		dnsRecordId: isRecordedHere ? recorded.dnsRecordId : null,
		exclusionRoutes,
		// A config that names the zone already deploys them.
		isActive: defaults.treeHostZone ? true : (recorded?.isActive ?? false)
	};
}

/**
 * A fresh clone has no manifest settings. Without this a re-run of `./setup` would regenerate the
 * deploy config without the vars and drop every tree subdomain, and teardown would leave the
 * record and the exclusion routes behind.
 */
export async function seedSubdomains(
	ctx: StepContext,
	manifest: Manifest,
	defaults: DeployDefaults
): Promise<Manifest> {
	if (manifest.subdomains) return manifest;
	const subdomains = await recoverSubdomainSettings(ctx, manifest, defaults);
	return subdomains ? ctx.save({ ...manifest, subdomains }) : manifest;
}

/** What teardown removes for the tree subdomains, each proved ours or recorded as made by us. */
export type SubdomainTeardownKey =
	'dnsRecord' | 'exclusionRoute' | 'treeRoute' | 'accessDestination';

export interface SubdomainTeardownItem {
	key: SubdomainTeardownKey;
	name: string;
	/** The record or route id; absent for the Access destination. */
	id?: string;
	/** The zone the record or route is on, so removing it needs no manifest settings. */
	zoneId?: string;
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
				items.push({
					key: 'dnsRecord',
					name: `DNS record *.${zone.name}`,
					id: record.id,
					zoneId: zone.id
				});
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
				items.push({
					key: 'treeRoute',
					name: `route ${route.pattern}`,
					id: route.id,
					zoneId: zone.id
				});
		}
		for (const owned of settings.exclusionRoutes) {
			const live = routes.find((r) => r.id === owned.id);
			if (
				owned.ownership === OWNERSHIPS.owned &&
				live &&
				live.script === null &&
				live.pattern === owned.pattern
			)
				items.push({
					key: 'exclusionRoute',
					name: `route ${owned.pattern}`,
					id: owned.id,
					zoneId: zone.id
				});
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
	if (item.key === 'dnsRecord' && item.id && item.zoneId)
		await ctx.cf.deleteDnsRecord(item.zoneId, item.id);
	if ((item.key === 'treeRoute' || item.key === 'exclusionRoute') && item.id && item.zoneId)
		await ctx.cf.deleteZoneRoute(item.zoneId, item.id);
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
