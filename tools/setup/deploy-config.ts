import { ERROR_CODES, SetupError } from './errors.ts';
import { parseJsonc } from './jsonc.ts';
import type { ResourceNames } from './names.ts';
import { HOSTINGS, type Hosting } from './options.ts';
import type { FileSystem } from './context.ts';
import type { InstallPaths } from './paths.ts';

/**
 * Plan step 8: `wrangler.deploy.jsonc` is the tracked `wrangler.jsonc` plus this install's
 * values. The file is tracked (ADR-038: nothing in it is a credential, and push-to-deploy needs
 * it), so setup regenerating it is a convenience for the owner, not a secrecy measure.
 */
export interface DeployValues {
	names: ResourceNames;
	hosting: Hosting;
	/** The host Access protects: the workers.dev host or the custom domain. */
	hostname: string;
	/** Custom domain only: keep the workers.dev URL on too. */
	isWorkersDevKept: boolean;
	teamDomain: string;
	installId: string;
	d1Id: string;
	/** Present only when the sender domain is verified; otherwise `send_email` is left out. */
	emailSender: string | null;
	r2Jurisdiction: string | null;
	/** Carried as a var unless the install keeps it as a secret (an adopted one). */
	accessAud: string | null;
}

type Json = Record<string, unknown>;
type JsonList = Json[];

function isJson(value: unknown): value is Json {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
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

export function parseTrackedConfig(text: string): Json {
	const value = parseJsonc(text);
	if (!isJson(value)) {
		throw new SetupError(ERROR_CODES.usage, 'wrangler.jsonc is not a JSON object');
	}
	return value;
}

export function generateDeployConfig(tracked: Json, values: DeployValues): Json {
	const config = structuredClone(tracked);
	const { names } = values;

	config.name = names.worker;
	if (values.hosting === HOSTINGS.workersDev) {
		config.workers_dev = true;
		delete config.routes;
	} else {
		config.routes = [{ pattern: values.hostname, custom_domain: true }];
		config.workers_dev = values.isWorkersDevKept;
		// Preview URLs would be a second, unprotected way in on workers.dev.
		if (values.isWorkersDevKept) delete config.preview_urls;
		else config.preview_urls = false;
	}
	config.vars = {
		...(isJson(config.vars) ? config.vars : {}),
		CF_ACCESS_TEAM_DOMAIN: values.teamDomain,
		EPOCH_INSTALL_ID: values.installId,
		...(values.accessAud ? { CF_ACCESS_AUD: values.accessAud } : {})
	};

	const d1 = bindingEntry(config, 'd1_databases', 'binding', 'DB');
	d1.database_name = names.d1;
	d1.database_id = values.d1Id;

	const r2 = bindingEntry(config, 'r2_buckets', 'binding', 'MEDIA_BUCKET');
	r2.bucket_name = names.r2;
	if (values.r2Jurisdiction) r2.jurisdiction = values.r2Jurisdiction;

	const queues = config.queues as { producers?: JsonList; consumers?: JsonList } | undefined;
	for (const entry of queues?.producers ?? []) entry.queue = names.queue;
	for (const entry of queues?.consumers ?? []) entry.queue = names.queue;

	bindingEntry(config, 'workflows', 'binding', 'GEDCOM_EXPORT_WORKFLOW').name = names.workflow;

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

const HEADER =
	'// Tracked. `npm run setup` regenerates this file from wrangler.jsonc plus this install’s ids,\n' +
	'// route and vars. Re-run setup to change it.\n';

export function renderDeployConfig(config: Json): string {
	return `${HEADER}${JSON.stringify(config, null, '\t')}\n`;
}

/**
 * The tracked wrangler.jsonc is the template. A checkout with none, an empty one or one that does not
 * parse (or lacks the Worker's bindings) falls back to the shipped copy, so setup works from nothing.
 */
export function loadTemplate(
	fs: FileSystem,
	paths: InstallPaths
): { config: Json; isFallback: boolean } {
	if (fs.exists(paths.trackedConfigFile)) {
		try {
			const tracked = parseTrackedConfig(fs.read(paths.trackedConfigFile));
			if (Array.isArray(tracked.d1_databases) && typeof tracked.main === 'string') {
				return { config: tracked, isFallback: false };
			}
		} catch {
			// Fall through to the shipped copy.
		}
	}
	return { config: parseTrackedConfig(fs.read(paths.templateFile)), isFallback: true };
}

/** What an earlier run, or a hand-written file, already decided. Every field may be absent. */
export interface DeployDefaults {
	workerName: string | null;
	hostname: string | null;
	hosting: Hosting | null;
	isWorkersDevKept: boolean | null;
	d1Id: string | null;
	teamDomain: string | null;
	installId: string | null;
}

export const NO_DEFAULTS: DeployDefaults = {
	workerName: null,
	hostname: null,
	hosting: null,
	isWorkersDevKept: null,
	d1Id: null,
	teamDomain: null,
	installId: null
};

/** Empty, missing or unparseable text means no defaults, never an error. */
export function parseDeployDefaults(text: string | null): DeployDefaults {
	if (!text || text.trim() === '') return NO_DEFAULTS;
	let config: unknown;
	try {
		config = parseJsonc(text);
	} catch {
		return NO_DEFAULTS;
	}
	if (!isJson(config)) return NO_DEFAULTS;
	const str = (value: unknown) => (typeof value === 'string' && value !== '' ? value : null);
	const route = Array.isArray(config.routes) ? (config.routes[0] as Json | undefined) : undefined;
	const vars = isJson(config.vars) ? config.vars : {};
	const d1 = Array.isArray(config.d1_databases)
		? (config.d1_databases[0] as Json | undefined)
		: undefined;
	const customHost = str(route?.pattern);
	return {
		workerName: str(config.name),
		hostname: customHost,
		hosting: customHost
			? HOSTINGS.custom
			: config.workers_dev === true
				? HOSTINGS.workersDev
				: null,
		isWorkersDevKept: customHost ? config.workers_dev === true : null,
		d1Id: str(d1?.database_id),
		teamDomain: str(vars.CF_ACCESS_TEAM_DOMAIN),
		installId: str(vars.EPOCH_INSTALL_ID)
	};
}

/** A small line diff (longest common subsequence) for showing what regenerating the file changes. */
export function lineDiff(before: string, after: string): string[] {
	const a = before.split('\n');
	const b = after.split('\n');
	const table = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
	for (let i = a.length - 1; i >= 0; i -= 1) {
		for (let j = b.length - 1; j >= 0; j -= 1) {
			table[i]![j] =
				a[i] === b[j] ? table[i + 1]![j + 1]! + 1 : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
		}
	}
	const out: string[] = [];
	let i = 0;
	let j = 0;
	while (i < a.length || j < b.length) {
		if (i < a.length && j < b.length && a[i] === b[j]) {
			i += 1;
			j += 1;
		} else if (j < b.length && (i === a.length || table[i]![j + 1]! > table[i + 1]![j]!)) {
			out.push(`+ ${b[j]}`);
			j += 1;
		} else {
			out.push(`- ${a[i]}`);
			i += 1;
		}
	}
	return out;
}
