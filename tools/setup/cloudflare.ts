import type { AccessPolicy, AccessRule } from './policy.ts';
import type { ObservedQueue, ObservedWorker } from './reconcile.ts';
import type { Runner } from './run.ts';

/**
 * Every `cf` call this tool makes, one function each, with the argv shape and the output shape
 * it assumes next to it. Command names were read from `cf cli search` and `cf schema`
 * (1.0.0-beta.13); flags and output shapes marked SPIKE are read from schemas but not yet seen
 * against a real account. `npm run setup -- spike` checks them read-only and `--dry-run`s the writes.
 */

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
}

interface AccessAppBody {
	name: string;
	domain: string;
	policyIds: string[];
	idpIds: string[];
	isAutoRedirect: boolean;
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

export interface CloudflareApi {
	/** Every account-scoped call uses this id. Set once the account is chosen. */
	useAccount(accountId: string): void;
	whoami(): Promise<Identity>;
	listAccounts(): Promise<AccountInfo[]>;
	listActiveZones(): Promise<ZoneInfo[]>;
	getTeamDomain(): Promise<string | null>;
	listIdentityProviders(): Promise<IdpInfo[]>;

	findD1(name: string): Promise<D1Info | null>;
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

	/** Email Sending domains on a zone, with whether each is verified (SPIKE: command may differ). */
	listEmailSenderDomains(zoneId: string): Promise<{ domain: string; isVerified: boolean }[]>;

	/** Teardown only. Each is called for a resource whose marker was proved ours. */
	deleteD1(id: string): Promise<void>;
	deleteR2Bucket(name: string): Promise<void>;
	deleteQueue(id: string): Promise<void>;
	deleteAccessApp(id: string): Promise<void>;
	deletePolicy(id: string): Promise<void>;

	mintDeployToken(name: string, expiresAt: Date): Promise<{ id: string; value: string }>;
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

export interface ApiOptions {
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
			typeof raw.enable_binding_cookie === 'boolean' ? raw.enable_binding_cookie : null
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
	/** Zero Trust commands take the scope as two positionals: `accounts <id>` (observed on applications create). */
	function zeroTrust(args: string[], tail: string[] = []) {
		return cf(['zero-trust', ...args, 'accounts', account(), ...tail]);
	}

	function toD1(raw: Rec): D1Info {
		return {
			id: str(raw.uuid) ?? str(raw.id) ?? '',
			name: str(raw.name) ?? '',
			createdAt: str(raw.created_at),
			sizeBytes: num(raw.file_size)
		};
	}

	function appBody(body: AccessAppBody): string {
		return JSON.stringify({
			type: 'self_hosted',
			name: body.name,
			domain: body.domain,
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

		// `cf auth whoami` — SPIKE: output shape. Looks for the common keys anywhere at top level.
		async whoami() {
			const out = await cf(['auth', 'whoami']);
			const rec = isRec(out) ? out : {};
			const user = isRec(rec.user) ? rec.user : rec;
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
			return asList(await cf(['accounts', 'list']), 'accounts').map((a) => ({
				id: str(a.id) ?? '',
				name: str(a.name) ?? ''
			}));
		},

		// Active only: Access needs an active zone (plan, Assumptions). Filtered here, not by a flag.
		async listActiveZones() {
			return asList(await cf(['zones', 'list']), 'zones')
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
			const args = ['r2', 'buckets', 'create', '--name', name];
			if (locationHint) args.push('--location-hint', locationHint);
			if (jurisdiction) args.push('--jurisdiction', jurisdiction);
			await cf([...args, ...dry]);
			return { name, createdAt: null };
		},
		// `cf r2 objects list <bucket>` (SPIKE: positional and output). Truncated at `limit`.
		async listR2Objects(bucket, limit) {
			const out = await cf(['r2', 'objects', 'list', bucket, '--per-page', String(limit)]);
			const objects = asList(out, 'objects', 'result');
			return {
				keys: objects.map((o) => str(o.key)).filter((k): k is string => k !== null),
				sizeBytes: objects.reduce((sum, o) => sum + (num(o.size) ?? 0), 0),
				isTruncated: isRec(out) && out.truncated === true
			};
		},

		async findQueue(name) {
			const queues = asList(await cf(['queues', 'list']), 'queues');
			const queue = queues.find((q) => q.queue_name === name);
			if (!queue) return null;
			const id = str(queue.queue_id) ?? '';
			// `cf queues consumers list <queue-id>`; the consumer's `script` is the Worker name (SPIKE).
			const consumers = asList(await cf(['queues', 'consumers', 'list', id]), 'consumers');
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

		// `cf workers scripts settings get <name>`; bindings list carries d1/r2/queue ids and plain_text vars (SPIKE).
		async getWorker(name) {
			let settings: unknown;
			try {
				settings = await cf(['workers', 'scripts', 'settings', 'get', name]);
			} catch {
				return null;
			}
			const rec = isRec(settings) ? settings : {};
			const bindings = asList(rec.bindings);
			const find = (type: string) => bindings.find((b) => b.type === type);
			return {
				name,
				lastDeployedAt: str(rec.modified_on),
				markerInstallId: str(bindings.find((b) => b.name === 'EPOCH_INSTALL_ID')?.text),
				boundD1Id: str(find('d1')?.id),
				boundR2Name: str(find('r2_bucket')?.bucket_name),
				boundQueueName: str(find('queue')?.queue_name)
			};
		},
		async readWorkerVar(name, variable) {
			const rec = await cf(['workers', 'scripts', 'settings', 'get', name]);
			const hit = asList(isRec(rec) ? rec.bindings : null).find((b) => b.name === variable);
			return str(hit?.text);
		},
		// `cf workers secrets bulk <name> --body '{…}'` (SPIKE: exact body shape).
		async putWorkerSecrets(name, secrets) {
			await cf(['workers', 'secrets', 'bulk', name, '--body', JSON.stringify(secrets), ...dry]);
		},
		// Our own Worker's custom domain owns a DNS record of its own, so it is checked first and not counted as a clash.
		async findHostnameUse(zoneId, hostname, ownWorker) {
			const domains = asList(await cf(['workers', 'domains', 'list']), 'result');
			const served = domains.find((d) => d.hostname === hostname);
			if (served)
				return served.service === ownWorker
					? null
					: `the Worker "${str(served.service)}" already serves ${hostname}`;
			const records = asList(
				await cf(['dns', 'records', 'list', '--zone', zoneId, '--name', hostname]),
				'result'
			);
			return records.length > 0 ? `a DNS record for ${hostname} already exists` : null;
		},

		async listAccessApps() {
			return asList(await zeroTrust(['access', 'applications', 'list']), 'result').map(parseApp);
		},
		async createAccessApp(body) {
			const out = await cf([
				'zero-trust',
				'access',
				'applications',
				'create',
				'accounts',
				account(),
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
				'accounts',
				account(),
				id,
				'--body',
				appBody(body),
				...dry
			]);
			return parseApp(requireRec(out, 'applications update'));
		},
		async listPolicies() {
			return asList(await zeroTrust(['access', 'policies', 'list']), 'result').map(parsePolicy);
		},
		async createPolicy(name, include) {
			const body = JSON.stringify({ name, decision: 'allow', include, exclude: [], require: [] });
			const out = await cf([
				'zero-trust',
				'access',
				'policies',
				'create',
				'accounts',
				account(),
				'--body',
				body,
				...dry
			]);
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
				'accounts',
				account(),
				policy.id,
				'--body',
				body,
				...dry
			]);
			return parsePolicy(requireRec(out, 'policies update'));
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
			await cf([
				'zero-trust',
				'access',
				'applications',
				'delete',
				'accounts',
				account(),
				id,
				...dry
			]);
		},
		async deletePolicy(id) {
			await cf(['zero-trust', 'access', 'policies', 'delete', 'accounts', account(), id, ...dry]);
		},

		async listEmailSenderDomains(zoneId) {
			const out = await cf(['email-sending', 'domains', 'list', '--zone', zoneId]);
			return asList(out, 'result').map((d) => ({
				domain: str(d.name) ?? str(d.domain) ?? '',
				isVerified: d.status === 'verified' || d.verified === true
			}));
		},

		// SPIKE: permission-group ids, and whether `--body` takes `policies` or `permission_groups`.
		async mintDeployToken(name, expiresAt) {
			const body = JSON.stringify({ name, expires_on: expiresAt.toISOString() });
			const out = requireRec(
				await cf(['accounts', 'tokens', 'create', 'accounts', account(), '--body', body], {
					hasSecretOutput: true
				}),
				'tokens create'
			);
			return { id: str(out.id) ?? '', value: str(out.value) ?? '' };
		},
		async deleteToken(id) {
			await cf(['accounts', 'tokens', 'delete', 'accounts', account(), id]);
		},
		async listTokens() {
			return asList(await cf(['accounts', 'tokens', 'list', 'accounts', account()]), 'result').map(
				(t) => ({
					id: str(t.id) ?? '',
					name: str(t.name) ?? ''
				})
			);
		}
	};
}
