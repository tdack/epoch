import type { StepContext } from '../context.ts';
import { withStepDone, type Manifest } from '../manifest.ts';
import { resourceNames } from '../names.ts';

export const CHECK_STATUSES = { pass: 'pass', fail: 'fail', skip: 'skip' } as const;
type CheckStatus = (typeof CHECK_STATUSES)[keyof typeof CHECK_STATUSES];

export interface CheckResult {
	name: string;
	status: CheckStatus;
	detail: string;
	/** Shown only on failure. */
	fix: string;
}

const CERTIFICATE_ATTEMPTS = 30;
const CERTIFICATE_WAIT_MS = 10_000;

async function get(ctx: StepContext, url: string): Promise<Response | null> {
	try {
		// Manual: the redirect itself is what is being checked.
		return await ctx.fetch(url, { redirect: 'manual' });
	} catch {
		return null;
	}
}

async function send(ctx: StepContext, url: string, init: RequestInit): Promise<Response | null> {
	try {
		return await ctx.fetch(url, { redirect: 'manual', ...init });
	} catch {
		return null;
	}
}

type Judged = [CheckStatus, string, string];

/** Pass on 401 (older Worker) or 200 with at most one tree, all viewer-role; anything else is a possible leak. */
async function judgePublicTrees(response: Response | null): Promise<Judged> {
	const leakHint =
		'Anonymous visitors must see no trees or the one public tree, as a viewer (ADR-041). More trees or any other role is a privacy leak: take the site down and investigate.';
	if (response?.status === 401) {
		return [
			CHECK_STATUSES.pass,
			'status 401 (a Worker built before the public tree answers this)',
			leakHint
		];
	}
	if (response?.status !== 200)
		return [CHECK_STATUSES.fail, `status ${response?.status ?? 'none'}`, leakHint];
	let body: unknown;
	try {
		body = await response.json();
	} catch {
		return [CHECK_STATUSES.fail, 'status 200 but the body is not JSON', leakHint];
	}
	const record = (body ?? {}) as { trees?: unknown; data?: { trees?: unknown } };
	const list = Array.isArray(record.trees) ? record.trees : record.data?.trees;
	if (!Array.isArray(list)) return [CHECK_STATUSES.fail, 'status 200 but no trees list', leakHint];
	const entries = list as { role?: unknown; name?: unknown; title?: unknown }[];
	if (entries.length > 1)
		return [CHECK_STATUSES.fail, `${entries.length} trees are visible anonymously`, leakHint];
	const other = entries.find((entry) => entry.role !== 'viewer');
	if (other)
		return [
			CHECK_STATUSES.fail,
			`a tree is visible with role "${String(other.role)}", not viewer`,
			leakHint
		];
	if (entries.length === 0) return [CHECK_STATUSES.pass, 'status 200, no public tree', leakHint];
	const label = String(entries[0]?.name ?? entries[0]?.title ?? 'unnamed');
	return [CHECK_STATUSES.pass, `status 200, public tree "${label}" (viewer)`, leakHint];
}

/** Plan step 10: read-only requests against the live host. Returns results; the caller decides how to react. */
export async function verify(
	ctx: StepContext,
	manifest: Manifest
): Promise<{ manifest: Manifest; results: CheckResult[] }> {
	const host = manifest.hostname ?? '';
	const base = `https://${host}`;
	const results: CheckResult[] = [];
	const add = (name: string, status: CheckStatus, detail: string, fix = '') =>
		results.push({ name, status, detail, fix });

	// A new custom domain can take minutes to get its certificate, which shows as a TLS failure.
	let welcome: Response | null = null;
	for (let attempt = 0; attempt < CERTIFICATE_ATTEMPTS && welcome === null; attempt += 1) {
		welcome = await get(ctx, `${base}/welcome`);
		if (welcome === null && attempt < CERTIFICATE_ATTEMPTS - 1)
			await ctx.sleep(CERTIFICATE_WAIT_MS);
	}
	add(
		'Certificate issued',
		welcome ? CHECK_STATUSES.pass : CHECK_STATUSES.fail,
		welcome ? 'HTTPS answers' : 'HTTPS did not answer',
		'Wait a few minutes; run `./setup doctor` to re-check.'
	);
	add(
		'GET /welcome is 200',
		welcome?.status === 200 ? CHECK_STATUSES.pass : CHECK_STATUSES.fail,
		`status ${welcome?.status ?? 'none'}`,
		'Check the deploy output and the Worker logs.'
	);

	const root = await get(ctx, `${base}/`);
	const rootLocation = root?.headers.get('location') ?? '';
	add(
		'GET / signed out redirects to /welcome',
		root?.status === 303 && rootLocation.includes('/welcome')
			? CHECK_STATUSES.pass
			: CHECK_STATUSES.fail,
		`status ${root?.status ?? 'none'} → ${rootLocation || 'no location'}`,
		'The Worker should redirect signed-out visitors (ADR-026).'
	);

	const login = await get(ctx, `${base}/login`);
	const loginLocation = login?.headers.get('location') ?? '';
	add(
		'GET /login is behind Access',
		login !== null &&
			login.status >= 300 &&
			login.status < 400 &&
			loginLocation.includes(manifest.teamDomain ?? '\0')
			? CHECK_STATUSES.pass
			: CHECK_STATUSES.fail,
		`status ${login?.status ?? 'none'} → ${loginLocation || 'no location'}`,
		`The Access application should cover ${host}/login with a policy that applies.`
	);

	// ADR-041: an anonymous read of /api/... is served as the public visitor, so `GET /api/trees` is
	// either empty or exactly one tree, as a viewer. A Worker built before that answers 401.
	const trees = await get(ctx, `${base}/api/trees`);
	add('Anonymous GET /api/trees shows at most the public tree', ...(await judgePublicTrees(trees)));

	// Writes stay deny-by-default. The empty body is never acted on: the request is refused as
	// signed-out (401) before validation, so nothing can be created; a 400/403 from the framework is
	// equally a refusal. Only a 2xx would mean an anonymous write was accepted.
	const write = await send(ctx, `${base}/api/trees`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: '{}'
	});
	const isRefused = write !== null && [400, 401, 403].includes(write.status);
	add(
		'Anonymous POST /api/trees is refused',
		isRefused ? CHECK_STATUSES.pass : CHECK_STATUSES.fail,
		`status ${write?.status ?? 'none'}`,
		'Writes must deny anonymous callers (ADR-015, ADR-041). A 2xx here means anyone can create trees: take the site down and investigate.'
	);

	const aud = manifest.access.app?.aud;
	if (manifest.isAudSecret) {
		add(
			'Deployed CF_ACCESS_AUD matches',
			CHECK_STATUSES.skip,
			'kept as a secret, which cannot be read back',
			''
		);
	} else {
		const deployed = await ctx.cf
			.readWorkerVar(resourceNames(manifest.workerName).worker, 'CF_ACCESS_AUD')
			.catch(() => null);
		add(
			'Deployed CF_ACCESS_AUD matches',
			deployed !== null && deployed === aud ? CHECK_STATUSES.pass : CHECK_STATUSES.fail,
			deployed === null
				? 'not readable'
				: deployed === aud
					? 'matches the application AUD'
					: 'differs from the application AUD',
			'Re-run setup so the deploy config carries the right AUD.'
		);
	}

	const next = results.every((r) => r.status !== CHECK_STATUSES.fail)
		? withStepDone(manifest, 'verify')
		: manifest;
	return { manifest: ctx.save(next), results };
}
