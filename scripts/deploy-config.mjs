// Shared by `npm run deploy` and the backfill scripts' --remote mode: every remote command must
// run against the generated, git-ignored wrangler.deploy.jsonc, never the dev-safe tracked file.
//
//   node scripts/deploy-config.mjs   # exits non-zero when the deploy config is missing or disagrees
import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { unstable_readConfig } from 'wrangler';

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
		throw new Error(`${DEPLOY_CONFIG} not found. Run \`npm run setup\` to generate it.`);
	}
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
		assertBuildFieldsAgree();
	} catch (error) {
		console.error(error.message);
		process.exit(1);
	}
}
