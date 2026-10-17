import type { StepContext } from '../context.ts';
import { lineDiff, loadTemplate } from '../deploy-config.ts';
import { generateDeployConfig, type DeployValues } from '../deploy-values.ts';
import { editConfigText, formatWithRepoConfig } from '../edit-config.ts';
import { ERROR_CODES, SetupError } from '../errors.ts';
import { withStepDone, type Manifest } from '../manifest.ts';

/**
 * Plan step 8: the template (the tracked wrangler.jsonc, or the shipped copy) plus this install's
 * values. The whole file is regenerated and the change against the old one is shown before writing.
 * The file is git-ignored (ADR-043); Workers Builds gets the same values as a build variable instead
 * (`steps/builds.ts`). The build-field agreement check is `scripts/deploy-config.mjs`, run as it
 * would be by `npm run deploy`, rather than a second copy of it.
 */
export async function writeConfig(ctx: StepContext, manifest: Manifest): Promise<Manifest> {
	const edited = await editedDeployConfig(ctx, manifest);
	if (edited.text === edited.before) {
		ctx.report.info('wrangler.deploy.jsonc unchanged');
	} else {
		const changes = lineDiff(edited.before ?? '', edited.text).filter(
			(line) => !line.startsWith('  ')
		);
		ctx.report.info(
			`wrangler.deploy.jsonc changes:\n${changes.slice(0, 60).join('\n')}${changes.length > 60 ? `\n… ${changes.length - 60} more` : ''}`
		);
		ctx.fs.write(ctx.paths.deployConfigFile, edited.text);
	}

	const check = await ctx.runner.exec({ tool: 'node', args: ['scripts/deploy-config.mjs'] });
	if (check.exitCode !== 0) {
		throw new SetupError(
			ERROR_CODES.command,
			check.stderr.trim() || 'wrangler.deploy.jsonc disagrees with wrangler.jsonc'
		);
	}
	return ctx.save(withStepDone(manifest, 'write-config'));
}

/** This install's values for the deploy config, as setup writes them and Workers Builds receives them. */
export function deployValuesOf(manifest: Manifest): DeployValues {
	if (!manifest.hostname || !manifest.teamDomain || !manifest.hosting) {
		throw new SetupError(
			ERROR_CODES.manifest,
			'The manifest lacks the host or team domain; re-run setup from the start'
		);
	}
	return {
		workerName: manifest.workerName,
		hosting: manifest.hosting,
		hostname: manifest.hostname,
		isWorkersDevKept: manifest.isWorkersDevKept,
		teamDomain: manifest.teamDomain,
		installId: manifest.installId,
		emailSender: manifest.emailSender,
		r2Jurisdiction: manifest.locations.r2Jurisdiction,
		accessAud: manifest.isAudSecret ? null : (manifest.access.app?.aud ?? null),
		...treeHostValues(manifest)
	};
}

function treeHostValues(
	manifest: Manifest
): Pick<DeployValues, 'treeHostZone' | 'reservedSubdomains' | 'appHost'> {
	const settings = manifest.subdomains;
	if (!settings?.isActive) return { treeHostZone: null, reservedSubdomains: [], appHost: null };
	return {
		treeHostZone: settings.zone.name,
		reservedSubdomains: settings.reservedLabels,
		appHost: settings.appHost
	};
}

/**
 * What the deploy config would be after this run, as text, edited in place from the existing file
 * (or from the template when there is none) and formatted with the repository's Prettier config.
 * `before` is null when there is no file yet.
 */
export async function editedDeployConfig(
	ctx: StepContext,
	manifest: Manifest
): Promise<{ text: string; before: string | null }> {
	const values = deployValuesOf(manifest);
	const template = loadTemplate(ctx.fs, ctx.paths);
	if (template.isFallback)
		ctx.report.info('No usable wrangler.jsonc here; using the copy shipped with the setup tool');
	const wanted = generateDeployConfig(template.config, values);
	const before = ctx.fs.exists(ctx.paths.deployConfigFile)
		? ctx.fs.read(ctx.paths.deployConfigFile)
		: null;
	const edited = editConfigText(before, template.text, wanted);
	const text = await formatWithRepoConfig(edited, ctx.paths.deployConfigFile, (message) =>
		ctx.report.warn(message)
	);
	return { text, before };
}
