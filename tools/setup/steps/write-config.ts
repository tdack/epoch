import type { StepContext } from '../context.ts';
import {
	generateDeployConfig,
	lineDiff,
	loadTemplate,
	renderDeployConfig
} from '../deploy-config.ts';
import { ERROR_CODES, SetupError } from '../errors.ts';
import { withStepDone, type Manifest } from '../manifest.ts';
import { resourceNames } from '../names.ts';

/**
 * Plan step 8: the template (the tracked wrangler.jsonc, or the shipped copy) plus this install's
 * values. The whole file is regenerated and the change against the old one is shown before writing.
 * The build-field agreement check is the deploy-config-split session's `scripts/deploy-config.mjs`,
 * run as it would be by `npm run deploy`, rather than a second copy of it.
 */
export async function writeConfig(ctx: StepContext, manifest: Manifest): Promise<Manifest> {
	const { d1 } = manifest.resources;
	if (!d1 || !manifest.hostname || !manifest.teamDomain || !manifest.hosting) {
		throw new SetupError(
			ERROR_CODES.manifest,
			'The manifest lacks the database, host or team domain; re-run setup from the start'
		);
	}
	const template = loadTemplate(ctx.fs, ctx.paths);
	if (template.isFallback)
		ctx.report.info('No usable wrangler.jsonc here; using the copy shipped with the setup tool');
	const config = generateDeployConfig(template.config, {
		names: resourceNames(manifest.workerName),
		hosting: manifest.hosting,
		hostname: manifest.hostname,
		isWorkersDevKept: manifest.isWorkersDevKept,
		teamDomain: manifest.teamDomain,
		installId: manifest.installId,
		d1Id: d1.id,
		emailSender: manifest.emailSender,
		r2Jurisdiction: manifest.locations.r2Jurisdiction,
		accessAud: manifest.isAudSecret ? null : (manifest.access.app?.aud ?? null)
	});
	const text = renderDeployConfig(config);
	const before = ctx.fs.exists(ctx.paths.deployConfigFile)
		? ctx.fs.read(ctx.paths.deployConfigFile)
		: '';
	const changes = lineDiff(before, text).filter((line) => !line.startsWith('  '));
	ctx.report.info(
		before === text
			? 'wrangler.deploy.jsonc is already up to date'
			: `wrangler.deploy.jsonc changes:\n${changes.slice(0, 60).join('\n')}${changes.length > 60 ? `\n… ${changes.length - 60} more` : ''}`
	);
	ctx.fs.write(ctx.paths.deployConfigFile, text);

	const check = await ctx.runner.exec({ tool: 'node', args: ['scripts/deploy-config.mjs'] });
	if (check.exitCode !== 0) {
		throw new SetupError(
			ERROR_CODES.command,
			check.stderr.trim() || 'wrangler.deploy.jsonc disagrees with wrangler.jsonc'
		);
	}
	return ctx.save(withStepDone(manifest, 'write-config'));
}
