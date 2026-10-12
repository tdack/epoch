import { ERROR_CODES, SetupError } from './errors.ts';
import { parseJsonc } from './jsonc.ts';
import { HOSTINGS, type Hosting } from './options.ts';
import type { FileSystem } from './context.ts';
import type { InstallPaths } from './paths.ts';

type Json = Record<string, unknown>;

function isJson(value: unknown): value is Json {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseTrackedConfig(text: string): Json {
	const value = parseJsonc(text);
	if (!isJson(value)) {
		throw new SetupError(ERROR_CODES.usage, 'wrangler.jsonc is not a JSON object');
	}
	return value;
}

/** Written only at the top of a file setup creates; an existing file keeps its own header. */
export const HEADER =
	'// Git-ignored (ADR-043). `npm run setup` regenerates this file from wrangler.jsonc plus this\n' +
	'// install’s values; on Workers Builds `npm run build:worker` writes it from EPOCH_DEPLOY_VALUES.\n' +
	'// `main` and `assets` must stay identical to wrangler.jsonc: the build reads them from that file.\n';

/**
 * The tracked wrangler.jsonc is the template. A checkout with none, an empty one or one that does not
 * parse (or lacks the Worker's bindings) falls back to the shipped copy, so setup works from nothing.
 */
export function loadTemplate(
	fs: FileSystem,
	paths: InstallPaths
): { config: Json; text: string; isFallback: boolean } {
	if (fs.exists(paths.trackedConfigFile)) {
		try {
			const text = fs.read(paths.trackedConfigFile);
			const tracked = parseTrackedConfig(text);
			if (Array.isArray(tracked.d1_databases) && typeof tracked.main === 'string') {
				return { config: tracked, text, isFallback: false };
			}
		} catch {
			// Fall through to the shipped copy.
		}
	}
	const text = fs.read(paths.templateFile);
	return { config: parseTrackedConfig(text), text, isFallback: true };
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
	/** The `send_email` sender an earlier file had, so it is kept unless the owner says otherwise. */
	emailSender: string | null;
}

export const NO_DEFAULTS: DeployDefaults = {
	workerName: null,
	hostname: null,
	hosting: null,
	isWorkersDevKept: null,
	d1Id: null,
	teamDomain: null,
	installId: null,
	emailSender: null
};

function firstSender(sendEmail: unknown): string | null {
	const entry = Array.isArray(sendEmail) ? (sendEmail[0] as Json | undefined) : undefined;
	const senders = entry?.allowed_sender_addresses;
	return Array.isArray(senders) && typeof senders[0] === 'string' ? senders[0] : null;
}

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
		installId: str(vars.EPOCH_INSTALL_ID),
		emailSender: firstSender(config.send_email)
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
