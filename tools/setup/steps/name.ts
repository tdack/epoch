import { resolveAnswer, type AnswerMode } from '../answers.ts';
import type { Asker } from '../asker.ts';
import type { StepContext } from '../context.ts';
import { NO_DEFAULTS, parseDeployDefaults, type DeployDefaults } from '../deploy-config.ts';
import { SetupError } from '../errors.ts';
import { loadManifest } from '../manifest.ts';
import { assertValidWorkerName, derivedNameSummary } from '../names.ts';
import { DEFAULT_WORKER_NAME, type SetupFlags } from '../options.ts';

/** What an earlier run or a hand-written wrangler.deploy.jsonc already decided; empty or missing means none. */
export function readDeployDefaults(ctx: StepContext): DeployDefaults {
	if (!ctx.fs.exists(ctx.paths.deployConfigFile)) return NO_DEFAULTS;
	return parseDeployDefaults(ctx.fs.read(ctx.paths.deployConfigFile));
}

function nameProblem(value: string): string | undefined {
	try {
		assertValidWorkerName(value);
		return undefined;
	} catch (error) {
		return error instanceof SetupError ? error.hint : 'Not a valid Worker name';
	}
}

/**
 * The Worker name is the base of every other name. Order: `--name`, the install already here, the
 * existing deploy config, then `epoch`. The derived names are shown with the prompt and again once chosen.
 */
export async function chooseWorkerName(
	ctx: StepContext,
	flags: SetupFlags,
	mode: AnswerMode,
	asker: Asker,
	defaults: DeployDefaults
): Promise<string> {
	const installed = loadManifest(ctx.fs, ctx.paths.manifestFile);
	const fallback = installed?.workerName ?? defaults.workerName ?? DEFAULT_WORKER_NAME;
	const resolution = resolveAnswer<string>(
		{ flag: '--name', flagValue: flags.name ?? installed?.workerName, defaultValue: fallback },
		mode
	);
	const name =
		resolution.status === 'answered'
			? resolution.value
			: (
					await asker.text({
						message: `Worker name (it names everything else)\n  e.g. ${derivedNameSummary(fallback)}`,
						initial: fallback,
						validate: (value) => nameProblem(value.trim())
					})
				).trim();
	assertValidWorkerName(name);
	ctx.report.info(`Worker "${name}": ${derivedNameSummary(name)}`);
	return name;
}
