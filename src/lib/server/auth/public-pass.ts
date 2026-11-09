/** The cookie that shows an anonymous visitor solved a Turnstile challenge (ADR-084). */
export const PUBLIC_PASS_COOKIE = 'epoch_pass';

/** How long one solved challenge lets an anonymous visitor read the public tree. */
export const PUBLIC_PASS_TTL_SECONDS = 24 * 60 * 60;

/** The Turnstile action the challenge page sends and siteverify must echo back. */
export const PUBLIC_READ_ACTION = 'public_read';

const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const MAX_TOKEN_LENGTH = 2048;
const encoder = new TextEncoder();

// shortcut: the pass is keyed from TURNSTILE_SECRET, so rotating that secret signs every visitor
// out of the public tree; give the pass its own secret if rotation ever needs to be silent.
function passKey(turnstileSecret: string): Promise<CryptoKey> {
	return crypto.subtle.importKey(
		'raw',
		encoder.encode(`epoch-public-pass:${turnstileSecret}`),
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['sign', 'verify']
	);
}

function toBase64Url(bytes: ArrayBuffer): string {
	return btoa(String.fromCharCode(...new Uint8Array(bytes)))
		.replaceAll('+', '-')
		.replaceAll('/', '_')
		.replace(/=+$/, '');
}

function fromBase64Url(text: string): Uint8Array<ArrayBuffer> | null {
	try {
		const binary = atob(text.replaceAll('-', '+').replaceAll('_', '/'));
		return Uint8Array.from(binary, (char) => char.charCodeAt(0));
	} catch {
		return null;
	}
}

/** A pass value, `<expiry seconds>.<signature>`, good for {@link PUBLIC_PASS_TTL_SECONDS}. */
export async function issuePublicPass(
	turnstileSecret: string,
	nowMs = Date.now()
): Promise<string> {
	const expires = String(Math.floor(nowMs / 1000) + PUBLIC_PASS_TTL_SECONDS);
	const signature = await crypto.subtle.sign(
		'HMAC',
		await passKey(turnstileSecret),
		encoder.encode(expires)
	);
	return `${expires}.${toBase64Url(signature)}`;
}

/** Whether `value` is an unexpired pass this install signed. `crypto.subtle.verify` compares in constant time. */
export async function isPublicPassValid(
	value: string | undefined,
	turnstileSecret: string,
	nowMs = Date.now()
): Promise<boolean> {
	const match = value ? /^(\d{1,12})\.([\w-]+)$/.exec(value) : null;
	if (!match) return false;
	const [, expires, signature] = match as unknown as [string, string, string];
	if (Number(expires) * 1000 <= nowMs) return false;
	const bytes = fromBase64Url(signature);
	if (!bytes) return false;
	return crypto.subtle.verify(
		'HMAC',
		await passKey(turnstileSecret),
		bytes,
		encoder.encode(expires)
	);
}

export interface TurnstileCheck {
	secret: string;
	token: unknown;
	remoteIp: string | null;
	/** The host the token was posted to; the widget must have been solved on the same one. */
	hostname: string;
}

/**
 * Whether siteverify accepts `token` for the public-read action on `hostname`. Fails closed on any
 * network, status or parse failure. Tokens are single-use, so a replay is refused by siteverify.
 */
export async function verifyTurnstileToken(check: TurnstileCheck): Promise<boolean> {
	const { token } = check;
	if (typeof token !== 'string' || token.length === 0 || token.length > MAX_TOKEN_LENGTH) {
		return false;
	}
	const body = new URLSearchParams({ secret: check.secret, response: token });
	if (check.remoteIp) body.set('remoteip', check.remoteIp);
	try {
		const response = await fetch(SITEVERIFY_URL, {
			method: 'POST',
			body,
			signal: AbortSignal.timeout(10_000)
		});
		if (!response.ok) return false;
		const result = (await response.json()) as {
			success?: unknown;
			action?: unknown;
			hostname?: unknown;
		};
		return (
			result.success === true &&
			result.action === PUBLIC_READ_ACTION &&
			result.hostname === check.hostname
		);
	} catch {
		return false;
	}
}
