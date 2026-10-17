import { UnauthenticatedError } from '../domain/errors';
import type { UserIdentity } from '../domain/identity';

interface AccessTokenPayload {
	sub: string;
	email: string;
	name?: string;
	iss: string;
	aud: string | string[];
	exp: number;
	nbf?: number;
	iat?: number;
	type?: string;
	identity_nonce?: string;
}

export interface AccessValidationConfig {
	teamDomain?: string; // e.g. "myteam.cloudflareaccess.com" or "https://myteam.cloudflareaccess.com"
	aud?: string; // Application AUD tag from Cloudflare Zero Trust
	allowDevBypass?: boolean; // If true and dev headers/tokens present, allow dev mock identity
}

interface JWK {
	kid: string;
	kty: string;
	alg: string;
	use?: string;
	n: string;
	e: string;
}

interface JWKS {
	keys: JWK[];
}

/**
 * The dev bypass is opt-in per environment: only the exact string `'true'` enables it, from any
 * of the supplied sources (SvelteKit env, Worker binding / `.dev.vars`).
 */
export function isDevBypassEnabled(...flags: Array<string | undefined | null>): boolean {
	return flags.some((flag) => flag === 'true');
}

const LOCAL_HOSTNAMES: readonly string[] = ['localhost', '127.0.0.1', '[::1]'];

/**
 * Whether a request's hostname (`URL.hostname`, so IPv6 keeps its brackets) is this machine. The
 * dev bypass is honoured only here: with just `/login` behind Access, a stray flag in production
 * would otherwise open every other path, and nothing at the edge would catch it.
 */
export function isLocalHostname(hostname: string): boolean {
	// `*.localhost` is reserved for loopback (RFC 6761), so a tree host can be tried locally as
	// `dacks.localhost`. The suffix match is exact: `localhost.evil.example` is not local.
	return LOCAL_HOSTNAMES.includes(hostname) || hostname.endsWith('.localhost');
}

interface JwksCache {
	domain: string;
	keys: JWK[];
	expiresAt: number;
}

/** Access rotates signing keys; a copy older than this is refetched on the next request. */
const JWKS_CACHE_TTL_MS = 10 * 60 * 1000;
/** A certs request must never hang a request thread; there is deliberately no retry. */
const JWKS_REQUEST_TIMEOUT_MS = 3_000;
/**
 * An unknown `kid` usually means Access rotated to a key we have not seen. We refetch once, but at
 * most once per this interval: otherwise a flood of tokens naming a bogus `kid` would turn every
 * verification into a request to the certs endpoint.
 */
const JWKS_MIN_FORCE_INTERVAL_MS = 60_000;

let jwksCache: JwksCache | null = null;
/** When the cached keys were last force-refetched for an unknown `kid`. */
let lastForcedFetchAt = 0;

function base64UrlDecode(str: string): Uint8Array<ArrayBuffer> {
	if (typeof Buffer !== 'undefined') {
		return new Uint8Array(Buffer.from(str, 'base64url'));
	}
	let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
	while (base64.length % 4 !== 0) {
		base64 += '=';
	}
	const binary = atob(base64);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) {
		bytes[i] = binary.charCodeAt(i);
	}
	return bytes;
}

function parseJwtParts(token: string): {
	header: Record<string, unknown>;
	payload: AccessTokenPayload;
	signature: Uint8Array<ArrayBuffer>;
	signedData: Uint8Array<ArrayBuffer>;
} {
	const parts = token.split('.');
	if (parts.length !== 3) {
		throw new UnauthenticatedError('Invalid JWT format');
	}

	const [headerB64, payloadB64, signatureB64] = parts;
	const headerJson = new TextDecoder().decode(base64UrlDecode(headerB64));
	const payloadJson = new TextDecoder().decode(base64UrlDecode(payloadB64));

	const header = JSON.parse(headerJson);
	const payload = JSON.parse(payloadJson) as AccessTokenPayload;
	const signature = base64UrlDecode(signatureB64);
	const signedData = new TextEncoder().encode(`${headerB64}.${payloadB64}`);

	return { header, payload, signature, signedData };
}

async function requestJwks(certsUrl: string): Promise<JWK[]> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), JWKS_REQUEST_TIMEOUT_MS);
	try {
		const res = await fetch(certsUrl, { signal: controller.signal });
		if (!res.ok) {
			throw new UnauthenticatedError(`Failed to fetch Access certificates: ${res.statusText}`);
		}

		const data = (await res.json()) as JWKS;
		if (!data?.keys || !Array.isArray(data.keys)) {
			throw new UnauthenticatedError('Invalid JWKS response from Access certs endpoint');
		}

		const now = Date.now();
		jwksCache = {
			domain: certsUrl,
			keys: data.keys,
			expiresAt: now + JWKS_CACHE_TTL_MS
		};

		return data.keys;
	} finally {
		clearTimeout(timer);
	}
}

async function fetchJwks(certsUrl: string): Promise<JWK[]> {
	const now = Date.now();
	if (jwksCache && jwksCache.domain === certsUrl && jwksCache.expiresAt > now) {
		return jwksCache.keys;
	}
	// Each request owns its fetch: sharing an in-flight promise across requests would run the
	// first request's I/O (and its abort signal) on behalf of a second, so a first-request
	// disconnect could spuriously reject the second. Only the positive cache is shared.
	return requestJwks(certsUrl);
}

/**
 * Refetch once for an unknown `kid`, in case Access rotated keys. Capped at one attempt per
 * `JWKS_MIN_FORCE_INTERVAL_MS`. A failed refetch returns the cached keys, which the caller has just
 * searched, so it ends in "no matching key" instead of a fetch error. Past `JWKS_CACHE_TTL_MS` the
 * cache is never served: the regular fetch fails closed, so a revoked key is not trusted for longer
 * than the TTL.
 */
async function fetchJwksForUnknownKid(certsUrl: string): Promise<JWK[]> {
	const now = Date.now();
	const cached = jwksCache && jwksCache.domain === certsUrl ? jwksCache : null;

	if (now - lastForcedFetchAt < JWKS_MIN_FORCE_INTERVAL_MS) {
		return cached ? cached.keys : requestJwks(certsUrl);
	}

	lastForcedFetchAt = now;
	try {
		return await requestJwks(certsUrl);
	} catch (err) {
		if (cached) return cached.keys;
		throw err;
	}
}

async function verifyRsaSignature(
	jwk: JWK,
	signature: Uint8Array<ArrayBuffer>,
	signedData: Uint8Array<ArrayBuffer>
): Promise<boolean> {
	const cryptoKey = await crypto.subtle.importKey(
		'jwk',
		{
			kty: jwk.kty,
			n: jwk.n,
			e: jwk.e,
			alg: 'RS256',
			ext: true
		},
		{
			name: 'RSASSA-PKCS1-v1_5',
			hash: { name: 'SHA-256' }
		},
		false,
		['verify']
	);

	return crypto.subtle.verify('RSASSA-PKCS1-v1_5', cryptoKey, signature, signedData);
}

/**
 * Validate Cloudflare Access JWT assertion.
 */
export async function validateAccessJwt(
	token: string,
	config: AccessValidationConfig
): Promise<UserIdentity> {
	if (!token || typeof token !== 'string') {
		throw new UnauthenticatedError('Missing Cloudflare Access token');
	}

	const { header, payload, signature, signedData } = parseJwtParts(token);

	// Access tokens are `typ: JWT` and, when the claim is present, `type: app`. Anything else is a
	// different kind of token that a shared signing key could otherwise be made to satisfy.
	if (header.typ !== undefined && header.typ !== 'JWT') {
		throw new UnauthenticatedError('Cloudflare Access token has an unexpected type');
	}
	if (payload.type !== undefined && payload.type !== 'app') {
		throw new UnauthenticatedError('Cloudflare Access token has an unexpected type');
	}

	// Fail closed: a missing `exp` would otherwise mean a token that never expires, and a present
	// but non-numeric `nbf` cannot be compared, so it is refused rather than skipped.
	const nowSeconds = Math.floor(Date.now() / 1000);
	if (
		typeof payload.exp !== 'number' ||
		!Number.isFinite(payload.exp) ||
		payload.exp < nowSeconds
	) {
		throw new UnauthenticatedError('Cloudflare Access token expired or has no expiry');
	}
	if (
		payload.nbf !== undefined &&
		(typeof payload.nbf !== 'number' || !Number.isFinite(payload.nbf) || payload.nbf > nowSeconds)
	) {
		throw new UnauthenticatedError('Cloudflare Access token not active yet');
	}

	// A dev/test token is the one case an audience check can be skipped: it never reaches the
	// production signature path below, and in local dev CF_ACCESS_AUD is often unset.
	const isDevBypassToken =
		!!config.allowDevBypass &&
		(header.alg === 'none' || payload.iss === 'https://test.cloudflareaccess.com');

	// Audience check. Fail closed: an unset AUD must reject a production token rather than
	// silently admit any token whose signature happens to verify.
	if (config.aud) {
		const payloadAuds = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
		if (!payloadAuds.includes(config.aud)) {
			throw new UnauthenticatedError('Invalid audience in Access token');
		}
	} else if (!isDevBypassToken) {
		throw new UnauthenticatedError('Access AUD is not configured');
	}

	if (isDevBypassToken) {
		if (!payload.sub || !payload.email) {
			throw new UnauthenticatedError('Invalid mock token: sub and email required');
		}
		return {
			id: '', // Will be mapped to internal user ID by repository
			accessSub: payload.sub,
			email: payload.email,
			name: payload.name || payload.email.split('@')[0]
		};
	}

	if (!config.teamDomain) {
		throw new UnauthenticatedError('Access team domain not configured');
	}

	const cleanDomain = config.teamDomain.replace(/^https?:\/\//, '').replace(/\/$/, '');
	const expectedIssuer = `https://${cleanDomain}`;
	if (payload.iss !== expectedIssuer) {
		throw new UnauthenticatedError(
			`Issuer mismatch: expected ${expectedIssuer}, received ${payload.iss}`
		);
	}

	const certsUrl = `https://${cleanDomain}/cdn-cgi/access/certs`;
	const keys = await fetchJwks(certsUrl);
	let matchingKey = keys.find((k) => k.kid === header.kid);
	if (!matchingKey) {
		// An unknown kid may be a key rotation we have not seen yet; refetch once before giving up.
		matchingKey = (await fetchJwksForUnknownKid(certsUrl)).find((k) => k.kid === header.kid);
	}
	if (!matchingKey) {
		throw new UnauthenticatedError(`No matching key found for kid: ${header.kid}`);
	}

	const isValid = await verifyRsaSignature(matchingKey, signature, signedData);
	if (!isValid) {
		throw new UnauthenticatedError('Invalid Access token signature');
	}

	if (!payload.sub || !payload.email) {
		throw new UnauthenticatedError('Missing sub or email in Access token payload');
	}

	return {
		id: '',
		accessSub: payload.sub,
		email: payload.email,
		name: payload.name || payload.email.split('@')[0]
	};
}

/**
 * Extract Access JWT from incoming Request headers or cookies.
 *
 * `Authorization: Bearer` is deliberately not read: Access never injects it, so accepting it would
 * widen the token intake to anything a client chooses to send.
 */
export function extractAccessJwt(request: Request): string | null {
	// Check header first (standard Cloudflare Access injection)
	const headerToken = request.headers.get('cf-access-jwt-assertion');
	if (headerToken) return headerToken.trim();

	const cookie = request.headers.get('cookie');
	if (cookie) {
		const match = cookie.match(/(?:^|;\s*)CF_Authorization=([^;]+)/);
		if (match) {
			return decodeURIComponent(match[1]).trim();
		}
	}

	return null;
}
