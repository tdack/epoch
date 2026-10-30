// Shared by `npm run build:worker` and the backfill scripts' --remote mode: every remote command
// runs against the git-ignored wrangler.deploy.jsonc, never the dev-safe wrangler.jsonc the build
// reads. On Workers Builds there is no such file, so it is written here from the EPOCH_DEPLOY_VALUES
// build variable that `./setup builds` sets (ADR-043).
//
//   node scripts/deploy-config.mjs   # exits non-zero when the deploy config is missing or disagrees
import { existsSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { experimental_readRawConfig, unstable_readConfig } from 'wrangler';
import {
	DEPLOY_VALUES_VARIABLE,
	generateDeployConfig,
	parseDeployValues
} from '../tools/setup/deploy-values.ts';

export const DEPLOY_CONFIG = 'wrangler.deploy.jsonc';
const TRACKED_CONFIG = 'wrangler.jsonc';

// adapter-cloudflare reads only these from the tracked file when it builds, so the build output
// is shaped by the tracked file while the Worker is deployed from the deploy file. Bindings are not
// among them, which is why they may differ; these may not.
const BUILD_FIELDS = {
	main: (c) => c.main,
	'assets.directory': (c) => c.assets?.directory,
	'assets.binding': (c) => c.assets?.binding,
	'assets.not_found_handling': (c) => c.assets?.not_found_handling,
	pages_build_output_dir: (c) => c.pages_build_output_dir
};

/** Throws a message fit to print when the deploy config is absent. */
export function requireDeployConfig() {
	if (!existsSync(DEPLOY_CONFIG)) {
		throw new Error(
			`${DEPLOY_CONFIG} not found. Run \`npm run setup\` to write it, or set ${DEPLOY_VALUES_VARIABLE} ` +
				'(`./setup builds` sets it on Workers Builds) so this script can write it.'
		);
	}
}

/**
 * Writes the deploy config from the variable when it is set, replacing any file already there: the
 * variable is what this install deploys with, so a stale local file must not win. Without the
 * variable this does nothing, which keeps a local `npm run deploy` on the file setup wrote.
 */
export async function writeDeployConfigFromEnv(env = process.env) {
	const text = env[DEPLOY_VALUES_VARIABLE];
	if (!text) return false;
	const { rawConfig } = await experimental_readRawConfig(
		{ config: TRACKED_CONFIG },
		{ useRedirectIfAvailable: false }
	);
	const config = generateDeployConfig(rawConfig, parseDeployValues(text));
	writeFileSync(
		DEPLOY_CONFIG,
		`// Written by scripts/deploy-config.mjs from ${DEPLOY_VALUES_VARIABLE}; git-ignored (ADR-043).\n` +
			`${JSON.stringify(config, null, '\t')}\n`
	);
	return true;
}

/**
 * Set only by `npm run deploy`, the command a Deploy to Cloudflare button runs (ADR-082). `./setup
 * builds` points Workers Builds at `build:worker` and `deploy:worker` instead, which never set it, so
 * a `./setup` install that has lost EPOCH_DEPLOY_VALUES still stops here rather than deploying the
 * dev-safe tracked file.
 */
export const BUTTON_DEPLOY_VARIABLE = 'EPOCH_BUTTON_DEPLOY';

/**
 * A button install has no setup values: the button provisioned the resources named in the tracked
 * file, and `/setup` keeps the rest in D1. So on Workers Builds, through `npm run deploy`, with
 * neither a deploy file nor the variable, the deploy config is the tracked file without
 * `send_email`, whose placeholder sender Cloudflare would refuse. Invitations are then saved but not
 * emailed, as for any install without a sender.
 */
export async function writeButtonDeployConfig(env = process.env) {
	if (env.WORKERS_CI !== '1' || env[BUTTON_DEPLOY_VARIABLE] !== '1') return false;
	if (env[DEPLOY_VALUES_VARIABLE] || existsSync(DEPLOY_CONFIG)) return false;
	const { rawConfig } = await experimental_readRawConfig(
		{ config: TRACKED_CONFIG },
		{ useRedirectIfAvailable: false }
	);
	const { send_email: _sendEmail, ...config } = rawConfig;
	writeFileSync(
		DEPLOY_CONFIG,
		`// Written by scripts/deploy-config.mjs for a Deploy to Cloudflare button install (ADR-082).\n` +
			`${JSON.stringify(config, null, '\t')}\n`
	);
	return true;
}

/** Throws when the deploy config is missing or disagrees with the tracked file on a build field. */
export function assertBuildFieldsAgree() {
	requireDeployConfig();
	const tracked = unstable_readConfig({ config: TRACKED_CONFIG });
	const deploy = unstable_readConfig({ config: DEPLOY_CONFIG });
	const mismatches = Object.entries(BUILD_FIELDS).flatMap(([field, read]) =>
		read(tracked) === read(deploy)
			? []
			: [`  ${field}: ${TRACKED_CONFIG} has ${read(tracked)}, ${DEPLOY_CONFIG} has ${read(deploy)}`]
	);
	if (mismatches.length > 0) {
		throw new Error(
			`${DEPLOY_CONFIG} disagrees with ${TRACKED_CONFIG} on fields the build reads:\n${mismatches.join('\n')}\n` +
				'The build uses the tracked file, so the deployed Worker would not match it. Re-run `npm run setup`.'
		);
	}
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
	try {
		if (await writeDeployConfigFromEnv()) {
			console.error(`Wrote ${DEPLOY_CONFIG} from ${DEPLOY_VALUES_VARIABLE}`);
		} else if (await writeButtonDeployConfig()) {
			console.error(`Wrote ${DEPLOY_CONFIG} from ${TRACKED_CONFIG} for a button install`);
		}
		assertBuildFieldsAgree();
	} catch (error) {
		console.error(error.hint ? `${error.message}\n${error.hint}` : error.message);
		process.exit(1);
	}
}
