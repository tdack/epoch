import { ERROR_CODES, SetupError } from './errors.ts';
import { assertValidWorkerName, resourceNames } from './names.ts';
import { HOSTINGS, type Hosting } from './options.ts';

/**
 * This module is imported by `scripts/deploy-config.mjs` on the Workers Builds host, where only the
 * root dependencies are installed. It must therefore import nothing outside `tools/setup` that has
 * a package behind it (no `jsonc-parser`, no `cf`), which is why it is not part of deploy-config.ts.
 */

/** The build variable that carries an install's values to Workers Builds (ADR-043). */
export const DEPLOY_VALUES_VARIABLE = 'EPOCH_DEPLOY_VALUES';

/**
 * What `wrangler.deploy.jsonc` adds to the tracked `wrangler.jsonc`. There is no D1 id: wrangler
 * resolves the database by `database_name` on deploy and on every remote `d1` command (ADR-043).
 */
export interface DeployValues {
	workerName: string;
	hosting: Hosting;
	/** The host Access protects: the workers.dev host or the custom domain. */
	hostname: string;
	/** Custom domain only: keep the workers.dev URL on too. */
	isWorkersDevKept: boolean;
	teamDomain: string;
	installId: string;
	/** Present only when the sender domain is verified; otherwise `send_email` is left out. */
	emailSender: string | null;
	r2Jurisdiction: string | null;
	/** Carried as a var unless the install keeps it as a secret (an adopted one). */
	accessAud: string | null;
	/** Trees are served on `<slug>.<zone>` (ADR-057); null leaves the feature off. */
	treeHostZone: string | null;
	/** Labels no tree may take beyond the app's built-in ones, sorted. Empty without a zone. */
	reservedSubdomains: string[];
	/** Set only when the app is not on the zone apex: the app reads an unset one as the zone. */
	appHost: string | null;
}

/** The wildcard Worker route that sends every tree subdomain to the Worker (ADR-057). */
export function treeHostRoute(zone: string): { pattern: string; zone_name: string } {
	return { pattern: `*.${zone}/*`, zone_name: zone };
}

type Json = Record<string, unknown>;
type JsonList = Json[];

function isJson(value: unknown): value is Json {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Fixed key order, so re-running setup with the same install upserts byte-identical text. */
export function serialiseDeployValues(values: DeployValues): string {
	return JSON.stringify({
		workerName: values.workerName,
		hosting: values.hosting,
		hostname: values.hostname,
		isWorkersDevKept: values.isWorkersDevKept,
		teamDomain: values.teamDomain,
		installId: values.installId,
		emailSender: values.emailSender,
		r2Jurisdiction: values.r2Jurisdiction,
		accessAud: values.accessAud,
		// Only with a zone, so an install without subdomains keeps the variable it has today.
		...(values.treeHostZone
			? {
					treeHostZone: values.treeHostZone,
					reservedSubdomains: [...new Set(values.reservedSubdomains)].sort(),
					appHost: values.appHost
				}
			: {})
	});
}

/** Throws a message fit to print on the build log when the variable is malformed. */
export function parseDeployValues(text: string): DeployValues {
	const fail = (detail: string): never => {
		throw new SetupError(ERROR_CODES.usage, `${DEPLOY_VALUES_VARIABLE} ${detail}`, {
			hint: 'Re-run `./setup builds` to set it again, or copy it from a working install.'
		});
	};
	let value: unknown;
	try {
		value = JSON.parse(text);
	} catch {
		return fail('is not JSON');
	}
	if (!isJson(value)) return fail('is not a JSON object');
	const required = (key: string): string => {
		const field = value[key];
		return typeof field === 'string' && field !== '' ? field : fail(`lacks "${key}"`);
	};
	const optional = (key: string): string | null => {
		const field = value[key];
		if (field === null || field === undefined) return null;
		return typeof field === 'string' ? field : fail(`has a non-string "${key}"`);
	};
	const hosting = required('hosting');
	if (hosting !== HOSTINGS.workersDev && hosting !== HOSTINGS.custom) {
		return fail(`has an unknown hosting "${hosting}"`);
	}
	const workerName = required('workerName');
	assertValidWorkerName(workerName);
	const reserved = value.reservedSubdomains ?? [];
	if (!Array.isArray(reserved) || !reserved.every((label) => typeof label === 'string')) {
		return fail('has a "reservedSubdomains" that is not a list of labels');
	}
	const treeHostZone = optional('treeHostZone');
	return {
		workerName,
		hosting,
		hostname: required('hostname'),
		isWorkersDevKept: value.isWorkersDevKept === true,
		teamDomain: required('teamDomain'),
		installId: required('installId'),
		emailSender: optional('emailSender'),
		r2Jurisdiction: optional('r2Jurisdiction'),
		accessAud: optional('accessAud'),
		// A variable set before subdomains existed has none of these, and must still build.
		treeHostZone,
		reservedSubdomains: treeHostZone ? (reserved as string[]) : [],
		appHost: treeHostZone ? optional('appHost') : null
	};
}

function bindingEntry(config: Json, key: string, field: string, binding: string): Json {
	const list = config[key];
	const found = Array.isArray(list)
		? (list as JsonList).find((entry) => entry[field] === binding)
		: undefined;
	if (!found) {
		throw new SetupError(
			ERROR_CODES.usage,
			`The tracked wrangler.jsonc has no ${key} entry with ${field} "${binding}"`,
			{ hint: 'The deploy config generator expects the shape of the tracked wrangler.jsonc.' }
		);
	}
	return found;
}

function treeHostVars(values: DeployValues): Record<string, string> {
	if (!values.treeHostZone) return {};
	const reserved = [...new Set(values.reservedSubdomains)].sort();
	return {
		EPOCH_TREE_HOST_ZONE: values.treeHostZone,
		...(reserved.length > 0 ? { EPOCH_RESERVED_SUBDOMAINS: reserved.join(',') } : {}),
		...(values.appHost ? { EPOCH_APP_HOST: values.appHost } : {})
	};
}

/** The tracked config plus this install's values. Pure: the same inputs give the same config. */
export function generateDeployConfig(tracked: Json, values: DeployValues): Json {
	const config = structuredClone(tracked);
	const names = resourceNames(values.workerName);

	config.name = names.worker;
	// `wrangler deploy` owns the wildcard route like the Custom Domain; setup creates only its DNS record.
	const treeRoutes = values.treeHostZone ? [treeHostRoute(values.treeHostZone)] : [];
	if (values.hosting === HOSTINGS.workersDev) {
		config.workers_dev = true;
		if (treeRoutes.length > 0) config.routes = treeRoutes;
		else delete config.routes;
	} else {
		config.routes = [{ pattern: values.hostname, custom_domain: true }, ...treeRoutes];
		config.workers_dev = values.isWorkersDevKept;
		// Preview URLs would be a second, unprotected way in on workers.dev.
		if (values.isWorkersDevKept) delete config.preview_urls;
		else config.preview_urls = false;
	}
	config.vars = {
		...(isJson(config.vars) ? config.vars : {}),
		CF_ACCESS_TEAM_DOMAIN: values.teamDomain,
		EPOCH_INSTALL_ID: values.installId,
		...(values.accessAud ? { CF_ACCESS_AUD: values.accessAud } : {}),
		// The mailer reads its sender from here, so no install's address is in the source.
		...(values.emailSender ? { EPOCH_EMAIL_SENDER: values.emailSender } : {}),
		...treeHostVars(values)
	};

	const d1 = bindingEntry(config, 'd1_databases', 'binding', 'DB');
	d1.database_name = names.d1;
	// Undefined rather than deleted, so editing a file written before ADR-043 removes its stale id.
	d1.database_id = undefined;

	const r2 = bindingEntry(config, 'r2_buckets', 'binding', 'MEDIA_BUCKET');
	r2.bucket_name = names.r2;
	if (values.r2Jurisdiction) r2.jurisdiction = values.r2Jurisdiction;

	const queues = config.queues as { producers?: JsonList; consumers?: JsonList } | undefined;
	for (const entry of queues?.producers ?? []) entry.queue = names.queue;
	for (const entry of queues?.consumers ?? []) entry.queue = names.queue;

	bindingEntry(config, 'workflows', 'binding', 'GEDCOM_EXPORT_WORKFLOW').name = names.workflow;
	bindingEntry(config, 'workflows', 'binding', 'PLACE_MATCH_WORKFLOW').name =
		names.placeMatchWorkflow;

	// A binding that names an unverified sender may fail the deploy (spike), and the app already
	// treats a missing binding as "not sent", so leaving it out is the safe default.
	if (values.emailSender) {
		bindingEntry(config, 'send_email', 'name', 'EMAIL').allowed_sender_addresses = [
			values.emailSender
		];
	} else {
		delete config.send_email;
	}
	return config;
}
