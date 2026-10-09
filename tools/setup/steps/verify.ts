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
		'Wait a few minutes; run `npm run setup -- doctor` to re-check.'
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

	const api = await get(ctx, `${base}/api/trees`);
	add(
		'GET /api/trees is 401',
		api?.status === 401 ? CHECK_STATUSES.pass : CHECK_STATUSES.fail,
		`status ${api?.status ?? 'none'}`,
		'API routes must deny by default.'
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
