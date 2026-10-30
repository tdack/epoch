import { error, fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { getDb } from '#lib/server/db/index.js';
import { InstallRepository } from '#lib/server/repositories/install-repository.js';
import { createCloudflareApi, SetupStepError } from '#lib/server/install/cloudflare-api.js';
import { claimInstall, parseWorkersDevHost } from '#lib/server/install/claim-install.js';
import { LOGIN_PATH } from '#lib/server/auth/public-routes.js';
import { Logger } from '#lib/server/logging/logger.js';

// Served to whoever reaches a fresh install, so it ships no client code; the form posts natively.
// SvelteKit reads this exact name, so it cannot take the boolean prefix.
// eslint-disable-next-line @typescript-eslint/naming-convention
export const csr = false;

/**
 * The permissions the token needs, as Cloudflare's token template URL takes them (ADR-082). An
 * account token, so it reaches one account and is not tied to the person who made it.
 */
const TOKEN_PERMISSIONS = [
	{ key: 'access', type: 'edit' },
	{ key: 'access_acct', type: 'read' },
	{ key: 'workers_scripts', type: 'read' }
];

const TOKEN_TEMPLATE_URL =
	'https://dash.cloudflare.com/?to=/:account/api-tokens' +
	`&permissionGroupKeys=${encodeURIComponent(JSON.stringify(TOKEN_PERMISSIONS))}` +
	`&name=${encodeURIComponent('Epoch setup (delete after use)')}`;

/**
 * Open only on a workers.dev address and only while no owner is recorded, read fresh each time
 * so the page closes the moment an install is claimed. Anything else gets the same bare 404, so
 * the page does not say whether an install exists.
 */
async function openSetup(url: URL, platform: App.Platform | undefined) {
	const host = parseWorkersDevHost(url.hostname);
	const d1 = platform?.env?.DB;
	if (!host || !d1) error(404, 'Not found');
	const install = new InstallRepository(getDb(d1));
	if (await install.hasOwner()) error(404, 'Not found');
	return { host, install };
}

export const load: PageServerLoad = async ({ url, platform, setHeaders }) => {
	setHeaders({ 'cache-control': 'no-store' });
	const { host } = await openSetup(url, platform);
	return {
		address: `${host.workerName}.${host.subdomain}.workers.dev`,
		tokenTemplateUrl: TOKEN_TEMPLATE_URL
	};
};

export const actions: Actions = {
	default: async ({ request, url, platform, locals }) => {
		const { host, install } = await openSetup(url, platform);
		const form = await request.formData();
		const ownerEmail = String(form.get('ownerEmail') ?? '');
		const token = String(form.get('token') ?? '').trim();
		// The token is never echoed back: a failed submission returns only the address.
		if (!token) return fail(400, { ownerEmail, message: 'Paste the API token you created.' });
		try {
			const result = await claimInstall({
				host,
				ownerEmail,
				api: createCloudflareApi(token),
				install,
				newInstallId: () => crypto.randomUUID()
			});
			return { isDone: true, loginHref: LOGIN_PATH, ...result };
		} catch (err) {
			if (err instanceof SetupStepError) return fail(400, { ownerEmail, message: err.message });
			new Logger({ correlationId: locals.correlationId, path: url.pathname }).error(
				'Setup failed',
				{ error: err instanceof Error ? err.message : String(err) }
			);
			return fail(500, { ownerEmail, message: 'Setup failed unexpectedly. Try again.' });
		}
	}
};
