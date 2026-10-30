/**
 * The few Cloudflare API calls `/setup` makes with the token the owner pastes (ADR-082). A Worker
 * cannot run the `cf` CLI that `tools/setup` drives, so this is plain `fetch` against the v4 API.
 * The token is held only by the closure and never appears in a thrown message.
 */

const API_BASE = 'https://api.cloudflare.com/client/v4';

/** Shown to the owner as is, so it never carries the token or a raw response body. */
export class SetupStepError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'SetupStepError';
	}
}

export interface CloudflareAccount {
	id: string;
	name: string;
}

export interface IdentityProvider {
	id: string;
	name: string;
}

export interface AccessApplication {
	id: string;
	domain: string;
	aud: string;
}

export interface AccessAppRequest {
	name: string;
	domain: string;
	policyIds: string[];
	idpIds: string[];
}

export interface CloudflareApi {
	listAccounts(): Promise<CloudflareAccount[]>;
	/** The account's workers.dev subdomain label, or null when it has none. */
	getWorkersSubdomain(accountId: string): Promise<string | null>;
	/** Whether the account has a Worker of exactly this name (a preview alias is not one). */
	hasWorker(accountId: string, name: string): Promise<boolean>;
	/** The Zero Trust team domain (`<team>.cloudflareaccess.com`), or null with no organisation. */
	getTeamDomain(accountId: string): Promise<string | null>;
	listIdentityProviders(accountId: string): Promise<IdentityProvider[]>;
	findPolicyByName(accountId: string, name: string): Promise<{ id: string } | null>;
	createOwnerPolicy(accountId: string, name: string, ownerEmail: string): Promise<{ id: string }>;
	findAppByDomain(accountId: string, domain: string): Promise<AccessApplication | null>;
	createApp(accountId: string, app: AccessAppRequest): Promise<AccessApplication>;
}

type Rec = Record<string, unknown>;

const isRec = (value: unknown): value is Rec =>
	typeof value === 'object' && value !== null && !Array.isArray(value);
const str = (value: unknown): string => (typeof value === 'string' ? value : '');
const list = (value: unknown): Rec[] => (Array.isArray(value) ? value.filter(isRec) : []);

/** Each call names what it was for, so a refusal tells the owner which permission is missing. */
export function createCloudflareApi(token: string, fetchFn: typeof fetch = fetch): CloudflareApi {
	async function call(
		purpose: string,
		path: string,
		init: { method?: string; body?: unknown; isNotFoundNull?: boolean } = {}
	): Promise<unknown> {
		let res: Response;
		try {
			res = await fetchFn(`${API_BASE}${path}`, {
				method: init.method ?? 'GET',
				headers: {
					authorization: `Bearer ${token}`,
					...(init.body === undefined ? {} : { 'content-type': 'application/json' })
				},
				body: init.body === undefined ? undefined : JSON.stringify(init.body)
			});
		} catch {
			throw new SetupStepError(`Could not reach Cloudflare to ${purpose}. Try again in a moment.`);
		}
		if (init.isNotFoundNull && res.status === 404) return null;
		const body: unknown = await res.json().catch(() => null);
		if (res.status === 401 || res.status === 403) {
			throw new SetupStepError(
				`Cloudflare refused the token when asked to ${purpose}. Check it has the permissions listed and was copied in full.`
			);
		}
		if (!res.ok || !isRec(body) || body.success === false) {
			const first = isRec(body) ? list(body.errors)[0] : undefined;
			const detail = first ? `: ${str(first.message)}` : '';
			throw new SetupStepError(`Cloudflare could not ${purpose} (HTTP ${res.status})${detail}.`);
		}
		return body.result;
	}

	const accountPath = (accountId: string, rest: string) =>
		`/accounts/${encodeURIComponent(accountId)}${rest}`;

	function parseApp(raw: unknown): AccessApplication {
		const app = isRec(raw) ? raw : {};
		return { id: str(app.id), domain: str(app.domain), aud: str(app.aud) };
	}

	return {
		async listAccounts() {
			const result = await call('list your accounts', '/accounts?per_page=50');
			return list(result).map((a) => ({ id: str(a.id), name: str(a.name) }));
		},
		async getWorkersSubdomain(accountId) {
			const result = await call(
				'read the workers.dev subdomain',
				accountPath(accountId, '/workers/subdomain'),
				{ isNotFoundNull: true }
			);
			return isRec(result) && str(result.subdomain) ? str(result.subdomain).toLowerCase() : null;
		},
		async hasWorker(accountId, name) {
			const result = await call(
				'read the Worker',
				accountPath(accountId, `/workers/scripts/${encodeURIComponent(name)}/settings`),
				{ isNotFoundNull: true }
			);
			return result !== null;
		},
		async getTeamDomain(accountId) {
			const result = await call(
				'read the Zero Trust organisation',
				accountPath(accountId, '/access/organizations'),
				{ isNotFoundNull: true }
			);
			return isRec(result) && str(result.auth_domain) ? str(result.auth_domain) : null;
		},
		async listIdentityProviders(accountId) {
			const result = await call(
				'list the Zero Trust login methods',
				accountPath(accountId, '/access/identity_providers')
			);
			return list(result).map((p) => ({ id: str(p.id), name: str(p.name) }));
		},
		async findPolicyByName(accountId, name) {
			const result = await call(
				'list the Access policies',
				accountPath(accountId, '/access/policies?per_page=100')
			);
			const hit = list(result).find((p) => p.name === name);
			return hit ? { id: str(hit.id) } : null;
		},
		async createOwnerPolicy(accountId, name, ownerEmail) {
			const result = await call(
				'create the Access policy',
				accountPath(accountId, '/access/policies'),
				{
					method: 'POST',
					body: {
						name,
						decision: 'allow',
						include: [{ email: { email: ownerEmail.toLowerCase() } }],
						exclude: [],
						require: []
					}
				}
			);
			const id = isRec(result) ? str(result.id) : '';
			if (!id) throw new SetupStepError('Cloudflare created the Access policy but returned no id.');
			return { id };
		},
		async findAppByDomain(accountId, domain) {
			const result = await call(
				'list the Access applications',
				accountPath(accountId, '/access/apps?per_page=100')
			);
			const hit = list(result).find((a) => str(a.domain).toLowerCase() === domain.toLowerCase());
			return hit ? parseApp(hit) : null;
		},
		async createApp(accountId, app) {
			const result = await call(
				'create the Access application',
				accountPath(accountId, '/access/apps'),
				{
					method: 'POST',
					// The same body `./setup` sends (tools/setup/cloudflare.ts), so either can adopt the other's.
					body: {
						type: 'self_hosted',
						name: app.name,
						domain: app.domain,
						policies: app.policyIds.map((id, index) => ({ id, precedence: index + 1 })),
						allowed_idps: app.idpIds,
						// With exactly one provider there is nothing to choose, so skip the picker.
						auto_redirect_to_identity: app.idpIds.length === 1,
						app_launcher_visible: false,
						// ADR-026: without these the CF_Authorization cookie is not sent on other paths.
						path_cookie_attribute: false,
						enable_binding_cookie: false
					}
				}
			);
			return parseApp(result);
		}
	};
}
