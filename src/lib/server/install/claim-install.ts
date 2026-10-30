import type { InstallRepository } from '../repositories/install-repository';
import { SetupStepError, type CloudflareApi } from './cloudflare-api';

const WORKERS_DEV_SUFFIX = '.workers.dev';

/** `<worker>.<subdomain>.workers.dev`, the only address `/setup` is served on (ADR-082). */
export interface WorkersDevHost {
	workerName: string;
	subdomain: string;
}

/**
 * The Worker and account subdomain a workers.dev hostname names, or null for any other host. A
 * preview alias (`<alias>-<worker>.…`) has the same shape, so `claimInstall` also checks that a
 * Worker of that name exists.
 */
export function parseWorkersDevHost(hostname: string): WorkersDevHost | null {
	const lower = hostname.toLowerCase();
	if (!lower.endsWith(WORKERS_DEV_SUFFIX)) return null;
	const labels = lower.slice(0, -WORKERS_DEV_SUFFIX.length).split('.');
	if (labels.length !== 2 || !labels[0] || !labels[1]) return null;
	return { workerName: labels[0], subdomain: labels[1] };
}

/**
 * The names `./setup` gives the same resources (`resourceNames` in tools/setup/names.ts), so a
 * button install moved to `./setup` later is adopted rather than duplicated. Keep the two in step.
 */
export function accessNames(workerName: string) {
	return {
		app: `Epoch (${workerName})`,
		policy: `Epoch ${workerName} sign-in`
	};
}

/** Not a full address check: Access compares the address itself, and this only catches a slip. */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface ClaimRequest {
	host: WorkersDevHost;
	ownerEmail: string;
	api: CloudflareApi;
	install: InstallRepository;
	newInstallId: () => string;
}

export interface ClaimResult {
	accountName: string;
	/**
	 * An Access application Epoch did not name already covered `/login` and was used as it was, so
	 * its own policy decides who signs in. Epoch's own app, found again on a retry, is not foreign.
	 */
	isAppForeign: boolean;
	/** The policy that admits the owner, when Epoch's own app is in use. */
	policyName: string;
	ownerEmail: string;
}

/**
 * Claims a button install: proves the token controls the Worker's account, puts Access in front
 * of `/login`, then records the owner. Each step finds before it creates, so a submission that
 * failed partway can simply be sent again. The owner is written last, in one insert that refuses
 * if a row exists, so the page closes only once sign-in can work.
 */
export async function claimInstall(request: ClaimRequest): Promise<ClaimResult> {
	const ownerEmail = request.ownerEmail.trim().toLowerCase();
	if (!EMAIL_PATTERN.test(ownerEmail)) {
		throw new SetupStepError('Enter the email address you will sign in with.');
	}
	const { api, host } = request;

	// The account check is what stops a stranger who reaches this page first: the subdomain is
	// unique to one account, so only a token for that account matches it.
	const accounts = await api.listAccounts();
	let account: (typeof accounts)[number] | null = null;
	for (const candidate of accounts) {
		if ((await api.getWorkersSubdomain(candidate.id)) === host.subdomain) {
			account = candidate;
			break;
		}
	}
	if (!account) {
		throw new SetupStepError(
			`This token cannot see the account that serves ${host.subdomain}.workers.dev. Create it on the account Epoch was deployed to.`
		);
	}

	// Otherwise a claim made on a preview alias would put Access in front of the alias's `/login`
	// and leave the real address with nothing to sign in through.
	if (!(await api.hasWorker(account.id, host.workerName))) {
		throw new SetupStepError(
			`Open this page at the Worker's own address, not a preview: ${host.workerName}.${host.subdomain}.workers.dev has no Worker of that name.`
		);
	}

	const teamDomain = await api.getTeamDomain(account.id);
	if (!teamDomain) {
		throw new SetupStepError(
			'This account has no Zero Trust organisation. Create one in the Cloudflare dashboard under Zero Trust, then try again.'
		);
	}
	const idps = await api.listIdentityProviders(account.id);
	if (idps.length === 0) {
		throw new SetupStepError(
			'Zero Trust has no login method yet. Add one under Zero Trust → Settings → Authentication (One-time PIN is the simplest), then try again.'
		);
	}

	const names = accessNames(host.workerName);
	const domain = `${host.workerName}.${host.subdomain}.workers.dev/login`;
	let app = await api.findAppByDomain(account.id, domain);
	if (!app) {
		const policy =
			(await api.findPolicyByName(account.id, names.policy)) ??
			(await api.createOwnerPolicy(account.id, names.policy, ownerEmail));
		app = await api.createApp(account.id, {
			name: names.app,
			domain,
			policyIds: [policy.id],
			idpIds: idps.map((idp) => idp.id)
		});
	}
	if (!app.aud) {
		throw new SetupStepError(
			'Cloudflare returned the Access application without its AUD tag. Try again in a moment.'
		);
	}

	const didClaim = await request.install.claim({
		installId: request.newInstallId(),
		ownerEmail,
		accessTeamDomain: teamDomain,
		accessAud: app.aud
	});
	if (!didClaim) throw new SetupStepError('This install already has an owner.');
	return {
		accountName: account.name,
		isAppForeign: app.name !== names.app,
		policyName: names.policy,
		ownerEmail
	};
}
