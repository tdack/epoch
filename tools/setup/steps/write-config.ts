import type { StepContext } from '../context.ts';
import {
	assertBuildFieldsAgree,
	generateDeployConfig,
	parseTrackedConfig,
	renderDeployConfig
} from '../deploy-config.ts';
import { ERROR_CODES, SetupError } from '../errors.ts';
import { withStepDone, type Manifest } from '../manifest.ts';
import { resourceNames } from '../names.ts';

/** Plan step 8: the tracked wrangler.jsonc plus this install's values, written next to it. */
export function writeConfig(ctx: StepContext, manifest: Manifest): Manifest {
	const { d1 } = manifest.resources;
	if (!d1 || !manifest.hostname || !manifest.teamDomain) {
		throw new SetupError(
			ERROR_CODES.manifest,
			'The manifest lacks the database, hostname or team domain; re-run setup from the start'
		);
	}
	const tracked = parseTrackedConfig(ctx.fs.read(ctx.paths.trackedConfigFile));
	const config = generateDeployConfig(tracked, {
		names: resourceNames(manifest.slug),
		hostname: manifest.hostname,
		teamDomain: manifest.teamDomain,
		installId: manifest.installId,
		d1Id: d1.id,
		emailSender: manifest.emailSender,
		r2Jurisdiction: manifest.locations.r2Jurisdiction,
		accessAud: manifest.isAudSecret ? null : (manifest.access.app?.aud ?? null)
	});
	assertBuildFieldsAgree(tracked, config);
	ctx.fs.write(ctx.paths.deployConfigFile, renderDeployConfig(config));
	return ctx.save(withStepDone(manifest, 'write-config'));
}
