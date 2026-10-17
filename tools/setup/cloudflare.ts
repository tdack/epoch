import { realMarker } from './install-meta.ts';
import {
	CommandError,
	ERROR_CODES,
	SetupError,
	TagConflictError,
	TagsUnavailableError
} from './errors.ts';
import type { R2LifecycleRule } from './lifecycle.ts';
import type { AccessPolicy, AccessRule } from './policy.ts';
import type { ObservedQueue, ObservedWorker } from './reconcile.ts';
import { describeCommand, mapFailure, unwrapEnvelope, type Runner } from './run.ts';
import { assertCanonicalTagId, type TaggedResource, type TagReading } from './tags.ts';

/**
 * Every `cf` call this tool makes, one function each, with the argv shape and the output shape
 * it assumes next to it. Command names were read from `cf cli search` and `cf schema`
 * (1.0.0-beta.13); flags and output shapes marked SPIKE are read from schemas but not yet seen
 * against a real account. `./setup spike` checks them read-only and `--dry-run`s the writes.
 */

/** Token permission groups a deploy needs, by the names `cf accounts tokens permission-groups list` returns (SPIKE). */
const DEPLOY_TOKEN_ACCOUNT_GROUPS = [
	'Workers Scripts Write',
	'D1 Write',
	'Workers R2 Storage Write',
	'Queues Write'
] as const;
const DEPLOY_TOKEN_ZONE_GROUPS = ['Workers Routes Write', 'DNS Write', 'Zone Read'] as const;

export interface Identity {
	email: string | null;
	userId: string | null;
	accountIds: string[];
	/** Granted OAuth scopes, or null when `cf` does not report them (SPIKE). */
	scopes: string[] | null;
}

export interface AccountInfo {
	id: string;
	name: string;
}
export interface ZoneInfo {
	id: string;
	name: string;
}
export interface IdpInfo {
	id: string;
	name: string;
	type: string;
}

interface AccessAppInfo {
	id: string;
	name: string;
	domain: string;
	aud: string;
	policyIds: string[];
	/** The two cookie settings ADR-026 needs off; null when the response omits them. */
	isPathCookieAttributeOn: boolean | null;
	isBindingCookieOn: boolean | null;
	/** Every public hostname-and-path it protects, `domain` first; just `domain` when none are listed. */
	destinations: string[];
}

interface AccessAppBody {
	name: string;
	domain: string;
	/**
	 * Further hostnames-and-paths beside `domain`, such as the tree subdomains' `*.<zone>/login`.
	 * Undefined sends `domain` alone; empty sends `destinations` too, so a removal is explicit.
	 */
	extraDestinations?: string[];
	policyIds: string[];
	idpIds: string[];
	isAutoRedirect: boolean;
}

export interface DnsRecord {
	id: string;
	/** The full hostname, e.g. `www.example.com`. */
	name: string;
	type: string;
	content: string;
	isProxied: boolean;
	comment: string | null;
}

export interface NewDnsRecord {
	type: string;
	/** Relative or full; Cloudflare stores the full hostname. */
	name: string;
	content: string;
	isProxied: boolean;
	comment: string;
}

/** A zone's Worker route. `script` null means "no Worker": the request goes on to the origin. */
export interface ZoneRoute {
	id: string;
	pattern: string;
	script: string | null;
}

/** A Workers Custom Domain: Cloudflare keeps its DNS record itself, so it may not be in the DNS list. */
export interface WorkerDomain {
	hostname: string;
	service: string;
}

interface D1Info {
	id: string;
	name: string;
	createdAt: string | null;
	sizeBytes: number | null;
}
interface R2Info {
	name: string;
	createdAt: string | null;
}

/** A Workers Builds trigger: one per connected branch set (production, and previews if on). */
export interface BuildTrigger {
	id: string;
	/** Often just the script id: the dashboard names a trigger after the Worker's tag. */
	name: string;
	buildCommand: string | null;
	deployCommand: string | null;
	/** Branch patterns that start a build; the production trigger lists only the production branch. */
	branchIncludes: string[];
	/** Path patterns that start a build; `["*"]` is every change. */
	pathIncludes: string[];
	pathExcludes: string[];
}

export interface BuildTriggerSettings {
	buildCommand: string;
	deployCommand: string;
	pathIncludes: readonly string[];
	pathExcludes: readonly string[];
}

export interface CloudflareApi {
	/** Every account-scoped call uses this id. Set once the account is chosen. */
	useAccount(accountId: string): void;
	whoami(): Promise<Identity>;
	listAccounts(): Promise<AccountInfo[]>;
	listActiveZones(): Promise<ZoneInfo[]>;
	getTeamDomain(): Promise<string | null>;
	/** The account's workers.dev subdomain, or null when none is set. Never set by this tool. */
	getWorkersSubdomain(): Promise<string | null>;
	listIdentityProviders(): Promise<IdpInfo[]>;

	findD1(name: string): Promise<D1Info | null>;
	/** By id, for the deploy config's hint. Null when it does not exist. */
	getD1(id: string): Promise<D1Info | null>;
	createD1(name: string, locationHint: string | null): Promise<D1Info>;
	queryD1(databaseId: string, sql: string): Promise<unknown[]>;

	findR2Bucket(name: string): Promise<R2Info | null>;
	createR2Bucket(
		name: string,
		locationHint: string | null,
		jurisdiction: string | null
	): Promise<R2Info>;
	listR2Objects(
		bucket: string,
		limit: number
	): Promise<{ keys: string[]; sizeBytes: number; isTruncated: boolean }>;
	/** The lifecycle rules a bucket already has, empty when it has none. */
	getR2Lifecycle(bucket: string): Promise<R2LifecycleRule[]>;
	/** Replace a bucket's lifecycle rules wholesale. A no-op under `--dry-run`. */
	putR2Lifecycle(bucket: string, rules: R2LifecycleRule[]): Promise<void>;

	findQueue(name: string): Promise<ObservedQueue | null>;
	createQueue(name: string): Promise<{ id: string; name: string }>;

	getWorker(name: string): Promise<ObservedWorker | null>;
	readWorkerVar(name: string, variable: string): Promise<string | null>;
	putWorkerSecrets(name: string, secrets: Record<string, string>): Promise<void>;
	/** Who serves this hostname already: a DNS record or another Worker's custom domain. Null when free. */
	findHostnameUse(zoneId: string, hostname: string, ownWorker: string): Promise<string | null>;

	listAccessApps(): Promise<AccessAppInfo[]>;
	createAccessApp(body: AccessAppBody): Promise<AccessAppInfo>;
	updateAccessApp(id: string, body: AccessAppBody): Promise<AccessAppInfo>;
	listPolicies(): Promise<AccessPolicy[]>;
	createPolicy(name: string, include: AccessRule[]): Promise<AccessPolicy>;
	updatePolicy(policy: AccessPolicy, include: AccessRule[]): Promise<AccessPolicy>;

	/** Every DNS record on the zone, all pages. */
	listDnsRecords(zoneId: string): Promise<DnsRecord[]>;
	createDnsRecord(zoneId: string, record: NewDnsRecord): Promise<DnsRecord>;
	deleteDnsRecord(zoneId: string, id: string): Promise<void>;
	/** Worker routes on the zone. `cf` has no command for them, so these are raw API calls. */
	listZoneRoutes(zoneId: string): Promise<ZoneRoute[]>;
	/** A route with no Worker. Wrangler cannot make one: its routes always attach the deployed Worker. */
	createExclusionRoute(zoneId: string, pattern: string): Promise<ZoneRoute>;
	deleteZoneRoute(zoneId: string, id: string): Promise<void>;
	/** Workers Custom Domains on the zone, any Worker's. */
	listWorkerDomains(zoneId: string): Promise<WorkerDomain[]>;

	/** Email Sending domains on a zone, with whether each is verified (SPIKE: command may differ). */
	listEmailSenderDomains(zoneId: string): Promise<{ domain: string; isVerified: boolean }[]>;

	/** Teardown only. Each is called for a resource whose marker was proved ours. */
	deleteD1(id: string): Promise<void>;
	deleteR2Bucket(name: string): Promise<void>;
	deleteQueue(id: string): Promise<void>;
	deleteAccessApp(id: string): Promise<void>;
	deletePolicy(id: string): Promise<void>;

	/**
	 * Resource tags (`cf tags`, `cf account-tags`). Every one throws `TagsUnavailableError` on a 403,
	 * a missing scope or the beta gate, and `putTags` throws `TagConflictError` on a stale ETag. Ids
	 * must be canonical; a wrong one is accepted by the API and tags nothing, so it is refused here.
	 */
	listTagged(filters: string[]): Promise<TaggedResource[]>;
	getTags(type: string, id: string): Promise<TagReading>;
	/** Replaces every tag on the resource; callers merge first. `etag` null is an unconditional write. */
	putTags(
		type: string,
		id: string,
		tags: Record<string, string>,
		etag: string | null
	): Promise<void>;
	deleteTags(type: string, id: string): Promise<void>;
	/** The Worker's 32-hex id (`id` in `cf workers list`): what tags and the Builds API key on. */
	getWorkerScriptId(name: string): Promise<string | null>;

	/**
	 * Workers Builds triggers for a Worker, by its script id (the Builds API's `external_script_id`).
	 * Empty when the repository has not been connected in the dashboard yet.
	 */
	listBuildTriggers(scriptId: string): Promise<BuildTrigger[]>;
	/** Adds or replaces these build variables on one trigger; others on it are left alone. */
	setBuildVariables(triggerId: string, variables: Record<string, string>): Promise<void>;
	/** Replaces the trigger's commands and path filters; branch filters and the token stay. */
	updateBuildTrigger(triggerId: string, settings: BuildTriggerSettings): Promise<void>;

	/** Names of the deploy-token permission groups this account does not offer; empty when minting can work. */
	missingDeployPermissionGroups(): Promise<string[]>;
	/** An account-owned token limited to this account and zone, for `--deploy-auth=ephemeral`. */
	mintDeployToken(
		name: string,
		expiresAt: Date,
		zoneId: string
	): Promise<{ id: string; value: string }>;
	deleteToken(id: string): Promise<void>;
	listTokens(): Promise<{ id: string; name: string }[]>;
}

type Rec = Record<string, unknown>;

function isRec(value: unknown): value is Rec {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function str(value: unknown): string | null {
	return typeof value === 'string' ? value : null;
}
function num(value: unknown): number | null {
	return typeof value === 'number' ? value : null;
}

function strings(value: unknown): string[] {
	return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

/** Lists come back as an array, or wrapped in a named key; accept both so one SPIKE answer fixes it. */
function asList(value: unknown, ...keys: string[]): Rec[] {
	if (Array.isArray(value)) return value.filter(isRec);
	if (isRec(value)) {
		for (const key of keys) {
			const inner = value[key];
			if (Array.isArray(inner)) return inner.filter(isRec);
		}
	}
	return [];
}

function requireRec(value: unknown, what: string): Rec {
	if (!isRec(value)) throw new Error(`Unexpected output for ${what}`);
	return value;
}

/**
 * The rules out of a lifecycle GET. The documented shape is `{ result: { rules: [...] } }`. Only a
 * 404 means "no rules" (and the caller reads that before calling here); any other shape is an
 * unexpected API change, and guessing at it would let `putR2Lifecycle` replace the whole set and
 * silently drop the owner's rules, so it throws instead.
 */
function lifecycleRulesFrom(body: unknown): R2LifecycleRule[] {
	if (!isRec(body) || !isRec(body.result) || !Array.isArray(body.result.rules)) {
		throw new SetupError(
			ERROR_CODES.command,
			'Unexpected R2 lifecycle response: expected { result: { rules: [...] } }'
		);
	}
	return body.result.rules.filter(isRec) as R2LifecycleRule[];
}

/** A read-only GET against the Cloudflare API itself, for what `cf` has no command for (a Worker's bindings). */
export type RawGet = (path: string) => Promise<{ status: number; body: unknown }>;

/** A raw API call of any method, for the few writes `cf` has no command for (the R2 lifecycle rules). */
export type RawRequest = (
	method: string,
	path: string,
	body?: unknown
) => Promise<{ status: number; body: unknown }>;

export interface ApiOptions {
	rawGet?: RawGet;
	/** The same endpoint with a method and a body, for writes `cf` cannot make. */
	rawRequest?: RawRequest;
	/** Append `--dry-run` to every write, for the spike. */
	isDryRun?: boolean;
}

function parsePolicy(raw: Rec): AccessPolicy {
	const rules = (key: string): AccessRule[] =>
		Array.isArray(raw[key]) ? (raw[key] as AccessRule[]) : [];
	return {
		id: str(raw.id) ?? '',
		name: str(raw.name) ?? '',
		decision: str(raw.decision) ?? 'unknown',
		include: rules('include'),
		exclude: rules('exclude'),
		require: rules('require'),
		appNames: []
	};
}

function parseApp(raw: Rec): AccessAppInfo {
	const policies = Array.isArray(raw.policies) ? (raw.policies as unknown[]) : [];
	return {
		id: str(raw.id) ?? '',
		name: str(raw.name) ?? '',
		domain: str(raw.domain) ?? '',
		aud: str(raw.aud) ?? '',
		policyIds: policies
			.map((p) => (isRec(p) ? str(p.id) : str(p)))
			.filter((id): id is string => id !== null),
		isPathCookieAttributeOn:
			typeof raw.path_cookie_attribute === 'boolean' ? raw.path_cookie_attribute : null,
		isBindingCookieOn:
			typeof raw.enable_binding_cookie === 'boolean' ? raw.enable_binding_cookie : null,
		destinations: destinationsOf(raw)
	};
}

/** SPIKE: `destinations` is `[{ type: 'public', uri }]` in the API reference; older apps have only `domain`. */
function destinationsOf(raw: Rec): string[] {
	const listed = Array.isArray(raw.destinations)
		? raw.destinations
				.filter(isRec)
				.filter((d) => d.type === undefined || d.type === 'public')
				.map((d) => str(d.uri))
				.filter((uri): uri is string => uri !== null)
		: [];
	if (listed.length > 0) return listed;
	const domain = str(raw.domain);
	return domain ? [domain] : [];
}

function toDnsRecord(rec: Rec): DnsRecord {
	return {
		id: str(rec.id) ?? '',
		name: str(rec.name) ?? '',
		type: str(rec.type) ?? '',
		content: str(rec.content) ?? '',
		isProxied: rec.proxied === true,
		comment: str(rec.comment)
	};
}

function toZoneRoute(rec: Rec): ZoneRoute {
	return {
		id: str(rec.id) ?? '',
		pattern: str(rec.pattern) ?? '',
		script: str(rec.script) || null
	};
}

export function createCloudflareApi(runner: Runner, options: ApiOptions): CloudflareApi {
	let accountId: string | null = null;
	const dry = options.isDryRun ? ['--dry-run'] : [];

	function account(): string {
		if (!accountId) throw new Error('No account chosen yet');
		return accountId;
	}

	/**
	 * No `--profile`: the profile is bound to the repository root and `run.ts` runs every child there.
	 * Account id is not a flag on `d1`, `r2`, `queues` or `workers` commands (SPIKE: read from
	 * `cf d1 list --help`), so it goes in `CLOUDFLARE_ACCOUNT_ID`.
	 */
	function cf(args: string[], extra: { hasSecretOutput?: boolean } = {}) {
		return runner.json({
			tool: 'cf',
			args,
			env: { CLOUDFLARE_ACCOUNT_ID: accountId ?? undefined },
			hasSecretOutput: extra.hasSecretOutput
		});
	}
	/**
	 * Zero Trust commands take no scope positionals: the real `spike` run showed `accounts <id>` fails
	 * with "Unknown commands", while a bare `access policies list` works. The account comes from
	 * CLOUDFLARE_ACCOUNT_ID like every other call (zone scope would be `-z`, which this tool never uses).
	 */
	function zeroTrust(args: string[], tail: string[] = []) {
		return cf(['zero-trust', ...args, ...tail]);
	}

	/**
	 * Tag calls read the exit code and text themselves instead of using `runner.json`, which folds a
	 * failure into one sentence and so cannot tell a stale ETag (412, retry) from a missing permission
	 * (403, degrade) from anything else (throw).
	 */
	async function tagCf(args: string[]): Promise<unknown> {
		const request = {
			tool: 'cf' as const,
			args,
			env: { CLOUDFLARE_ACCOUNT_ID: accountId ?? undefined }
		};
		const result = await runner.exec(request);
		if (result.exitCode !== 0) {
			const output = `${result.stderr}\n${result.stdout}`;
			const command = describeCommand(request);
			if (/\b412\b|precondition failed/i.test(output)) throw new TagConflictError(command);
			if (
				/\b403\b|\b9109\b|forbidden|insufficient scope|missing scope|permission|not (yet )?(enabled|available|entitled)|entitle|private beta|feature/i.test(
					output
				)
			) {
				throw new TagsUnavailableError(mapFailure(output, command));
			}
			throw new CommandError(mapFailure(output, command), command);
		}
		if (result.stdout.trim() === '') return null;
		try {
			return unwrapEnvelope(JSON.parse(result.stdout));
		} catch {
			throw new CommandError('The command did not print JSON', describeCommand(request));
		}
	}

	function tagBody(type: string, id: string, tags?: Record<string, string>): string {
		assertCanonicalTagId(type, id);
		return JSON.stringify({ resource_type: type, resource_id: id, ...(tags ? { tags } : {}) });
	}

	function toTagged(rec: Rec): TaggedResource {
		const tags: Record<string, string> = {};
		if (isRec(rec.tags)) {
			for (const [key, value] of Object.entries(rec.tags))
				if (typeof value === 'string') tags[key] = value;
		}
		return {
			type: str(rec.type) ?? '',
			id: str(rec.id) ?? '',
			name: str(rec.name) ?? '',
			tags,
			etag: str(rec.etag) ?? ''
		};
	}

	async function raw(path: string) {
		if (!options.rawGet) throw new Error('No raw API reader configured');
		return options.rawGet(path);
	}

	/** A raw API call with a method and body, for the writes `cf` has no command for. */
	async function rawRequest(method: string, path: string, body?: unknown) {
		if (!options.rawRequest) throw new Error('No raw API writer configured');
		return options.rawRequest(method, path, body);
	}

	function routesPath(zoneId: string): string {
		return `/zones/${encodeURIComponent(zoneId)}/workers/routes`;
	}

	/** The `result` of a raw call, or a SetupError naming what failed. */
	async function rawResult(method: string, path: string, what: string, body?: unknown) {
		const res = await rawRequest(method, path, body);
		if (res.status >= 400 || !isRec(res.body) || res.body.success === false) {
			throw new SetupError(ERROR_CODES.command, `Could not ${what} (HTTP ${res.status})`);
		}
		return res.body.result;
	}

	function lifecyclePath(bucket: string): string {
		return `/accounts/${account()}/r2/buckets/${encodeURIComponent(bucket)}/lifecycle`;
	}

	/** Null only for "no such Worker" (HTTP 404, or error code 10007); every other failure throws. */
	async function workerSettings(name: string): Promise<Rec | null> {
		const res = await raw(
			`/accounts/${account()}/workers/scripts/${encodeURIComponent(name)}/settings`
		);
		const errors =
			isRec(res.body) && Array.isArray(res.body.errors) ? (res.body.errors as Rec[]) : [];
		if (res.status === 404 || errors.some((e) => e.code === 10007)) return null;
		if (res.status >= 400 || !isRec(res.body) || !isRec(res.body.result)) {
			throw new SetupError(
				ERROR_CODES.command,
				`Could not read the Worker "${name}" (HTTP ${res.status})`,
				{
					hint: 'Setup will not guess whether it exists. Check the sign-in and re-run.'
				}
			);
		}
		return res.body.result;
	}

	function toD1(rec: Rec): D1Info {
		return {
			id: str(rec.uuid) ?? str(rec.id) ?? '',
			name: str(rec.name) ?? '',
			createdAt: str(rec.created_at),
			sizeBytes: num(rec.file_size)
		};
	}

	function appBody(body: AccessAppBody): string {
		const extra = body.extraDestinations;
		return JSON.stringify({
			type: 'self_hosted',
			name: body.name,
			domain: body.domain,
			// An update replaces the application, so a re-run that sent `domain` alone could drop the
			// tree subdomains' destination.
			...(extra
				? {
						destinations: [body.domain, ...extra].map((uri) => ({ type: 'public', uri }))
					}
				: {}),
			policies: body.policyIds.map((id, index) => ({ id, precedence: index + 1 })),
			allowed_idps: body.idpIds,
			auto_redirect_to_identity: body.isAutoRedirect,
			app_launcher_visible: false,
			// README and ADR-026: without these the CF_Authorization cookie is not sent on other paths.
			path_cookie_attribute: false,
			enable_binding_cookie: false
		});
	}

	return {
		useAccount(id) {
			accountId = id;
		},

		// `cf` has no command for this (checked in `cf schema --list`), so it is the raw
		// `GET /accounts/{id}/workers/subdomain`. 404 or no subdomain field means none is set; anything else throws.
		async getWorkersSubdomain() {
			const res = await raw(`/accounts/${account()}/workers/subdomain`);
			if (res.status === 404) return null;
			if (res.status >= 400 || !isRec(res.body)) {
				throw new SetupError(
					ERROR_CODES.command,
					`Could not read the workers.dev subdomain (HTTP ${res.status})`
				);
			}
			return isRec(res.body.result) ? str(res.body.result.subdomain) : null;
		},

		// `cf auth whoami` prints `{ authenticated, authSource, tokenValid, email?, accounts, scopes?,
		// expiresAt? }` (read from cf's source). Signed out is `{ authenticated: false }` with exit 0, so
		// that is checked here; scopes appear only for an OAuth login, never for an API token.
		async whoami() {
			const out = await cf(['auth', 'whoami']);
			const rec = isRec(out) ? out : {};
			if (rec.authenticated !== true || rec.tokenValid === false) {
				throw new SetupError(ERROR_CODES.command, 'cf is not signed in', {
					hint: 'Run `./setup --force` to sign in again.'
				});
			}
			const user = rec;
			const accounts = asList(rec.accounts, 'result');
			const scopes = Array.isArray(rec.scopes)
				? rec.scopes.filter((s): s is string => typeof s === 'string')
				: null;
			return {
				email: str(user.email),
				userId: str(user.id) ?? str(user.user_id),
				accountIds: accounts.map((a) => str(a.id)).filter((id): id is string => id !== null),
				scopes
			};
		},

		async listAccounts() {
			return asList(await cf(['accounts', 'list', '--per-page', '50']), 'accounts').map((a) => ({
				id: str(a.id) ?? '',
				name: str(a.name) ?? ''
			}));
		},

		// Active only: Access needs an active zone (plan, Assumptions). Filtered here, not by a flag.
		async listActiveZones() {
			return asList(await cf(['zones', 'list', '--per-page', '50']), 'zones')
				.filter((z) => z.status === 'active')
				.map((z) => ({ id: str(z.id) ?? '', name: str(z.name) ?? '' }));
		},

		// SPIKE: `auth_domain` is the API field; null means no Zero Trust organisation.
		async getTeamDomain() {
			try {
				const out = await zeroTrust(['organization', 'get']);
				return isRec(out) ? str(out.auth_domain) : null;
			} catch {
				return null;
			}
		},

		// `cf zero-trust identity-providers list` (not `access identity-providers`, as the plan said).
		async listIdentityProviders() {
			return asList(await zeroTrust(['identity-providers', 'list']), 'result').map((p) => ({
				id: str(p.id) ?? '',
				name: str(p.name) ?? '',
				type: str(p.type) ?? ''
			}));
		},

		async findD1(name) {
			const found = asList(await cf(['d1', 'list', '--name', name]), 'result').map(toD1);
			return found.find((db) => db.name === name) ?? null;
		},
		// `cf d1 get <database-id>`; a failure is "cannot confirm", which only costs the hint.
		async getD1(id) {
			try {
				return toD1(requireRec(await cf(['d1', 'get', id]), 'd1 get'));
			} catch {
				return null;
			}
		},
		async createD1(name, locationHint) {
			const args = ['d1', 'create', '--name', name];
			if (locationHint) args.push('--primary-location-hint', locationHint);
			return toD1(requireRec(await cf([...args, ...dry]), 'd1 create'));
		},
		// `cf d1 query <database-id> --sql …`; output is a list of statement results with `results` rows (SPIKE).
		async queryD1(databaseId, sql) {
			const out = await cf(['d1', 'query', databaseId, '--sql', sql]);
			const first = asList(out, 'result')[0];
			return Array.isArray(first?.results) ? first.results : [];
		},

		async findR2Bucket(name) {
			const out = await cf(['r2', 'buckets', 'list']);
			const list = asList(isRec(out) && Array.isArray(out.buckets) ? out.buckets : out, 'buckets');
			const found = list.find((b) => b.name === name);
			return found ? { name, createdAt: str(found.creation_date) } : null;
		},
		async createR2Bucket(name, locationHint, jurisdiction) {
			if (jurisdiction) {
				// `cf r2 buckets create` has no jurisdiction field (its body is name, location-hint and
				// storage-class), so a jurisdictional bucket is made with wrangler.
				const args = ['r2', 'bucket', 'create', name, '--jurisdiction', jurisdiction];
				if (locationHint) args.push('--location', locationHint);
				await runner.text({ tool: 'wrangler', args, env: { CLOUDFLARE_ACCOUNT_ID: account() } });
				return { name, createdAt: null };
			}
			const args = ['r2', 'buckets', 'create', '--name', name];
			if (locationHint) args.push('--location-hint', locationHint);
			await cf([...args, ...dry]);
			return { name, createdAt: null };
		},
		// `cf r2 objects list <bucket>` (SPIKE: positional and output). Truncated at `limit`.
		async listR2Objects(bucket, limit) {
			const out = await cf([
				'r2',
				'objects',
				'list',
				'--bucket-name',
				bucket,
				'--per-page',
				String(limit)
			]);
			const objects = asList(out, 'objects', 'result');
			return {
				keys: objects.map((o) => str(o.key)).filter((k): k is string => k !== null),
				sizeBytes: objects.reduce((sum, o) => sum + (num(o.size) ?? 0), 0),
				isTruncated: isRec(out) && out.truncated === true
			};
		},

		// `cf` cannot set lifecycle rules (checked in `cf schema --list`), so this is the raw
		// `GET /accounts/{id}/r2/buckets/{name}/lifecycle`. A bucket with no rules is a 404, read as none.
		async getR2Lifecycle(bucket) {
			const res = await rawRequest('GET', lifecyclePath(bucket));
			if (res.status === 404) return [];
			if (res.status >= 400) {
				throw new SetupError(
					ERROR_CODES.command,
					`Could not read the R2 lifecycle rules for "${bucket}" (HTTP ${res.status})`
				);
			}
			return lifecycleRulesFrom(res.body);
		},
		// A raw PUT cannot take `--dry-run`, so under the spike's dry run the write is skipped rather
		// than performed. The rules replace the bucket's set wholesale, hence the read-merge before it.
		async putR2Lifecycle(bucket, rules) {
			if (options.isDryRun) return;
			const res = await rawRequest('PUT', lifecyclePath(bucket), { rules });
			if (res.status >= 400) {
				throw new SetupError(
					ERROR_CODES.command,
					`Could not set the R2 lifecycle rules for "${bucket}" (HTTP ${res.status})`
				);
			}
		},

		async findQueue(name) {
			const queues = asList(await cf(['queues', 'list']), 'queues');
			const queue = queues.find((q) => q.queue_name === name);
			if (!queue) return null;
			const id = str(queue.queue_id) ?? '';
			// `cf queues consumers list <queue-id>`; the consumer's `script` is the Worker name (SPIKE).
			const consumers = asList(
				await cf(['queues', 'consumers', 'list', '--queue-id', id]),
				'consumers'
			);
			return {
				id,
				name,
				consumerWorker: str(consumers[0]?.script) ?? str(consumers[0]?.script_name)
			};
		},
		async createQueue(name) {
			const out = requireRec(
				await cf(['queues', 'create', '--queue-name', name, ...dry]),
				'queues create'
			);
			return { id: str(out.queue_id) ?? '', name };
		},

		// `cf` has no command that reads a Worker (checked in `cf schema --list`: only deployments and
		// secrets), so this is `GET /accounts/{id}/workers/scripts/{name}/settings` through `rawGet`.
		// Only a plain "not found" means absent; any other failure throws, because reading "absent"
		// from a broken call would let a deploy overwrite a same-named Worker that is not ours.
		async getWorker(name) {
			const settings = await workerSettings(name);
			if (settings === null) return null;
			const bindings = asList(settings.bindings);
			const find = (type: string) => bindings.find((b) => b.type === type);
			return {
				name,
				lastDeployedAt: null,
				markerInstallId: realMarker(str(bindings.find((b) => b.name === 'EPOCH_INSTALL_ID')?.text)),
				boundD1Id: str(find('d1')?.id),
				boundR2Name: str(find('r2_bucket')?.bucket_name),
				boundQueueName: str(find('queue')?.queue_name)
			};
		},
		async readWorkerVar(name, variable) {
			const settings = await workerSettings(name);
			const hit = asList(settings?.bindings).find((b) => b.name === variable);
			return str(hit?.text);
		},
		// `cf workers secrets bulk <name> --body '{…}'` (SPIKE: exact body shape).
		async putWorkerSecrets(name, secrets) {
			await cf(['workers', 'secrets', 'bulk', name, '--body', JSON.stringify(secrets), ...dry]);
		},
		// Our own Worker's custom domain owns a DNS record of its own, so it is checked first and not
		// counted as a clash. `cf` has no Workers-domains command either, hence `rawGet`.
		async findHostnameUse(zoneId, hostname, ownWorker) {
			const res = await raw(
				`/accounts/${account()}/workers/domains?hostname=${encodeURIComponent(hostname)}`
			);
			if (res.status >= 400)
				throw new SetupError(
					ERROR_CODES.command,
					`Could not list Workers custom domains (HTTP ${res.status})`
				);
			const domains = asList(isRec(res.body) ? res.body.result : null);
			const served = domains.find((d) => d.hostname === hostname);
			if (served) {
				return served.service === ownWorker
					? null
					: `the Worker "${str(served.service)}" already serves ${hostname}`;
			}
			const records = asList(
				await cf(['dns', 'records', 'list', '--zone', zoneId, '--name', hostname]),
				'result'
			);
			return records.length > 0 ? `a DNS record for ${hostname} already exists` : null;
		},

		async listAccessApps() {
			return asList(
				await zeroTrust(['access', 'applications', 'list'], ['--per-page', '100']),
				'result'
			).map(parseApp);
		},
		async createAccessApp(body) {
			const out = await cf([
				'zero-trust',
				'access',
				'applications',
				'create',
				'--body',
				appBody(body),
				...dry
			]);
			return parseApp(requireRec(out, 'applications create'));
		},
		async updateAccessApp(id, body) {
			const out = await cf([
				'zero-trust',
				'access',
				'applications',
				'update',
				id,
				'--body',
				appBody(body),
				...dry
			]);
			return parseApp(requireRec(out, 'applications update'));
		},
		async listPolicies() {
			return asList(
				await cf(['zero-trust', 'access', 'policies', 'list', '--per-page', '100']),
				'result'
			).map(parsePolicy);
		},
		async createPolicy(name, include) {
			const body = JSON.stringify({ name, decision: 'allow', include, exclude: [], require: [] });
			// Policies are account-level, so these take no scope positionals (the account comes from the environment).
			const out = await cf(['zero-trust', 'access', 'policies', 'create', '--body', body, ...dry]);
			return parsePolicy(requireRec(out, 'policies create'));
		},
		async updatePolicy(policy, include) {
			const body = JSON.stringify({
				name: policy.name,
				decision: policy.decision,
				include,
				exclude: policy.exclude,
				require: policy.require
			});
			const out = await cf([
				'zero-trust',
				'access',
				'policies',
				'update',
				policy.id,
				'--body',
				body,
				...dry
			]);
			return parsePolicy(requireRec(out, 'policies update'));
		},

		// A bare array, as recorded. If cf ever wraps it with a `cursor`, follow it; a page boundary
		// must not hide an install from the name check.
		async listTagged(filters) {
			const found: TaggedResource[] = [];
			let cursor: string | null = null;
			for (let page = 0; page < 50; page += 1) {
				const args = ['tags', 'resources', 'list', ...filters.flatMap((tag) => ['--tag', tag])];
				if (cursor) args.push('--cursor', cursor);
				const out = await tagCf(args);
				found.push(...asList(out, 'resources', 'result').map(toTagged));
				cursor = isRec(out) ? str(out.cursor) : null;
				if (!cursor) break;
			}
			return found;
		},
		async getTags(type, id) {
			assertCanonicalTagId(type, id);
			const out = requireRec(
				await tagCf(['account-tags', 'get', '--resource-type', type, '--resource-id', id]),
				'account-tags get'
			);
			const { tags, etag } = toTagged(out);
			return { tags, etag };
		},
		// `--body` only: `--tags` is rejected and `--resource-type` is dropped when a body is given, so
		// the body carries all three fields.
		async putTags(type, id, tags, etag) {
			const args = ['account-tags', 'update', '--body', tagBody(type, id, tags)];
			if (etag) args.push('--if-match', etag);
			await tagCf([...args, ...dry]);
		},
		async deleteTags(type, id) {
			await tagCf(['account-tags', 'delete', '--body', tagBody(type, id), '--force', ...dry]);
		},
		// `cf workers list` (the /workers/workers API) names each Worker by `name` and gives its 32-hex
		// id as `id`, as the owner's account showed (beta.14). It is paged, so read until a short page.
		async getWorkerScriptId(name) {
			const perPage = 100;
			for (let page = 1; ; page += 1) {
				const workers = asList(
					await cf(['workers', 'list', '--per-page', String(perPage), '--page', String(page)]),
					'result',
					'workers'
				);
				const found = workers.find((w) => w.name === name);
				if (found) {
					const id = str(found.id);
					return id !== null && /^[0-9a-f]{32}$/.test(id) ? id : null;
				}
				if (workers.length < perPage) return null;
			}
		},

		// `cf builds triggers list --external-script-id <tag>`, read on the live install (beta.14).
		// Each entry has the shape in fixtures/build-trigger.json.
		async listBuildTriggers(scriptId) {
			const out = await cf(['builds', 'triggers', 'list', '--external-script-id', scriptId]);
			return asList(out, 'result', 'triggers')
				.filter((t) => !str(t.deleted_on))
				.map((t) => ({
					id: str(t.trigger_uuid) ?? '',
					name: str(t.trigger_name) ?? '',
					buildCommand: str(t.build_command),
					deployCommand: str(t.deploy_command),
					branchIncludes: strings(t.branch_includes),
					pathIncludes: strings(t.path_includes),
					pathExcludes: strings(t.path_excludes)
				}))
				.filter((t) => t.id !== '');
		},
		// Visible rather than secret: nothing in the values is a credential (ADR-043), and a secret
		// could not be read back to tell whether it is current.
		async setBuildVariables(triggerId, variables) {
			const body = Object.fromEntries(
				Object.entries(variables).map(([key, value]) => [key, { value, is_secret: false }])
			);
			await cf([
				'builds',
				'triggers',
				'environment-variables',
				'upsert',
				triggerId,
				'--body',
				JSON.stringify(body),
				...dry
			]);
		},

		// Every flag here was confirmed on the owner's account (beta.14): a repeated path flag sets
		// one pattern each.
		async updateBuildTrigger(triggerId, settings) {
			await cf([
				'builds',
				'triggers',
				'update',
				triggerId,
				'--build-command',
				settings.buildCommand,
				'--deploy-command',
				settings.deployCommand,
				...settings.pathIncludes.flatMap((path) => ['--path-includes', path]),
				...settings.pathExcludes.flatMap((path) => ['--path-excludes', path]),
				...dry
			]);
		},

		async deleteD1(id) {
			await cf(['d1', 'delete', id, ...dry]);
		},
		async deleteR2Bucket(name) {
			await cf(['r2', 'buckets', 'delete', name, ...dry]);
		},
		async deleteQueue(id) {
			await cf(['queues', 'delete', id, ...dry]);
		},
		async deleteAccessApp(id) {
			await cf(['zero-trust', 'access', 'applications', 'delete', id, ...dry]);
		},
		async deletePolicy(id) {
			await cf(['zero-trust', 'access', 'policies', 'delete', id, ...dry]);
		},

		// `cf dns records list --zone <id>` with the API's `per_page` and `page` (`cf schema dns records
		// list`). Read until a short page, so a record past the first page still counts as captured.
		async listDnsRecords(zoneId) {
			const perPage = 500;
			const records: DnsRecord[] = [];
			for (let page = 1; page <= 100; page += 1) {
				const batch = asList(
					await cf([
						'dns',
						'records',
						'list',
						'--zone',
						zoneId,
						'--per-page',
						String(perPage),
						'--page',
						String(page)
					]),
					'result'
				).map(toDnsRecord);
				records.push(...batch);
				if (batch.length < perPage) break;
			}
			return records;
		},
		// SPIKE: `cf dns records create` lists no body fields in its schema, so the record goes in `--body`.
		async createDnsRecord(zoneId, record) {
			const body = JSON.stringify({
				type: record.type,
				name: record.name,
				content: record.content,
				proxied: record.isProxied,
				ttl: 1,
				comment: record.comment
			});
			const out = await cf(['dns', 'records', 'create', '--zone', zoneId, '--body', body, ...dry]);
			return toDnsRecord(requireRec(out, 'dns records create'));
		},
		async deleteDnsRecord(zoneId, id) {
			await cf(['dns', 'records', 'delete', id, '--zone', zoneId, ...dry]);
		},
		async listZoneRoutes(zoneId) {
			return asList(
				await rawResult('GET', routesPath(zoneId), 'list the Worker routes on the zone')
			).map(toZoneRoute);
		},
		// No `script` field is what makes the route Worker-less. A raw call cannot take `--dry-run`,
		// so the spike's dry run skips it, as it does the lifecycle rules.
		async createExclusionRoute(zoneId, pattern) {
			if (options.isDryRun) return { id: '', pattern, script: null };
			const out = await rawResult('POST', routesPath(zoneId), `add the route ${pattern}`, {
				pattern
			});
			return toZoneRoute(requireRec(out, 'routes create'));
		},
		async deleteZoneRoute(zoneId, id) {
			if (options.isDryRun) return;
			await rawResult(
				'DELETE',
				`${routesPath(zoneId)}/${encodeURIComponent(id)}`,
				`delete the route ${id}`
			);
		},
		async listWorkerDomains(zoneId) {
			const out = await rawResult(
				'GET',
				`/accounts/${account()}/workers/domains?zone_id=${encodeURIComponent(zoneId)}`,
				'list Workers custom domains'
			);
			return asList(out).map((d) => ({
				hostname: str(d.hostname) ?? '',
				service: str(d.service) ?? ''
			}));
		},

		// Email Sending is per subdomain (`cf email-sending subdomains list --zone`); there is no
		// "domains" command. SPIKE: which field says verified.
		async listEmailSenderDomains(zoneId) {
			const out = await cf(['email-sending', 'subdomains', 'list', '--zone', zoneId]);
			return asList(out, 'result').map((d) => ({
				domain: str(d.name) ?? str(d.domain) ?? '',
				isVerified: d.status === 'verified' || d.verified === true || d.dns_status === 'verified'
			}));
		},

		async missingDeployPermissionGroups() {
			const groups = asList(
				await cf(['accounts', 'tokens', 'permission-groups', 'list']),
				'result'
			);
			return [...DEPLOY_TOKEN_ACCOUNT_GROUPS, ...DEPLOY_TOKEN_ZONE_GROUPS].filter(
				(name) => !groups.some((g) => g.name === name)
			);
		},
		// Permission groups are resolved by name from `cf accounts tokens permission-groups list` at mint
		// time and the mint fails loudly if one is missing: a token without them cannot deploy.
		// SPIKE: that these names exist and are enough for `wrangler deploy` with a custom domain.
		async mintDeployToken(name, expiresAt, zoneId) {
			const groups = asList(
				await cf(['accounts', 'tokens', 'permission-groups', 'list']),
				'result'
			);
			const resolve = (names: readonly string[]) =>
				names.map((groupName) => {
					const found = groups.find((g) => g.name === groupName);
					if (!found || !str(found.id)) {
						throw new SetupError(
							ERROR_CODES.command,
							`This account has no token permission group named "${groupName}"`,
							{
								hint: 'Use the default --deploy-auth (a wrangler sign-in) instead.'
							}
						);
					}
					return { id: str(found.id) };
				});
			const body = JSON.stringify({
				name,
				expires_on: expiresAt.toISOString(),
				policies: [
					{
						effect: 'allow',
						resources: { [`com.cloudflare.api.account.${account()}`]: '*' },
						permission_groups: resolve(DEPLOY_TOKEN_ACCOUNT_GROUPS)
					},
					{
						effect: 'allow',
						resources: { [`com.cloudflare.api.account.zone.${zoneId}`]: '*' },
						permission_groups: resolve(DEPLOY_TOKEN_ZONE_GROUPS)
					}
				]
			});
			const out = requireRec(
				await cf(['accounts', 'tokens', 'create', '--body', body, ...dry], {
					hasSecretOutput: true
				}),
				'tokens create'
			);
			return { id: str(out.id) ?? '', value: str(out.value) ?? '' };
		},
		async deleteToken(id) {
			await cf(['accounts', 'tokens', 'delete', id]);
		},
		async listTokens() {
			return asList(await cf(['accounts', 'tokens', 'list']), 'result').map((t) => ({
				id: str(t.id) ?? '',
				name: str(t.name) ?? ''
			}));
		}
	};
}
