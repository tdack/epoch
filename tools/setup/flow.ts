import type { AnswerMode } from './answers.ts';
import type { Asker } from './asker.ts';
import type { StepContext } from './context.ts';
import { ERROR_CODES, SetupError } from './errors.ts';
import { lastCompletedStep, withStepDone, type Manifest } from './manifest.ts';
import type { SetupFlags } from './options.ts';
import { access } from './steps/access.ts';
import { configureBuilds } from './steps/builds.ts';
import { WORKER_CHOICES, resolveExistingWorker } from './steps/existing-worker.ts';
import { chooseWorkerName, readDeployDefaults } from './steps/name.ts';
import { collect } from './steps/collect.ts';
import { handOff } from './steps/hand-off.ts';
import { markConfigured } from './steps/mark-configured.ts';
import { migrateMarkDeploy } from './steps/migrate-mark-deploy.ts';
import { buildPlan, confirmAdoptions, type PlanLine } from './steps/plan.ts';
import { preflight } from './steps/preflight.ts';
import { provision } from './steps/provision.ts';
import { applyAdoptions, reconcileStep } from './steps/reconcile.ts';
import { signIn } from './steps/sign-in.ts';
import { TAG_STATES, TAGGABLE_KEYS, tagResources } from './tags.ts';
import { CHECK_STATUSES, verify, type CheckResult } from './steps/verify.ts';
import { editedDeployConfig, writeConfig } from './steps/write-config.ts';

/** What the flow needs from the terminal. ui.ts implements it; `--json` and tests use quiet ones. */
export interface Presenter {
	stage(title: string): void;
	/** Runs `work` under a spinner labelled `label`. */
	task<T>(label: string, work: () => Promise<T>): Promise<T>;
	showPlan(lines: PlanLine[]): void;
	showChecks(results: CheckResult[]): void;
	showHandOff(lines: string[]): void;
	showExisting(manifest: Manifest): void;
}

export interface SetupResult {
	manifest: Manifest;
	plan: PlanLine[];
	/** Empty for `--plan`. */
	checks: CheckResult[];
	isApplied: boolean;
	handOff: string[];
}

/** Plan steps 1 to 11, plus the Workers Builds variable (ADR-043). Each step reads the manifest and answers; only `collect` and the plan confirmation prompt. */
export async function runSetup(
	ctx: StepContext,
	flags: SetupFlags,
	mode: AnswerMode,
	asker: Asker,
	presenter: Presenter
): Promise<SetupResult> {
	presenter.stage('Preflight');
	const defaults = readDeployDefaults(ctx);
	const name = await chooseWorkerName(ctx, flags, mode, asker, defaults);
	const pre = preflight(ctx, { ...flags, name });
	let manifest = pre.manifest;
	if (pre.isResume) presenter.showExisting(manifest);

	presenter.stage('Sign in');
	const signed = await presenter.task('Checking the Cloudflare sign-in', () =>
		signIn(ctx, manifest, flags)
	);
	manifest = signed.manifest;

	presenter.stage('Collect');
	const collected = await collect(ctx, manifest, flags, signed.identity, mode, asker, defaults);
	manifest = collected.manifest;
	let { answers } = collected;

	presenter.stage('Reconcile');
	const reconciled = await presenter.task('Checking what already exists', () =>
		reconcileStep(ctx, manifest, answers, pre.isResume, defaults.d1Id)
	);
	manifest = reconciled.manifest;
	let isWorkerReplaced = false;
	if (reconciled.existingWorker) {
		const outcome = await resolveExistingWorker(
			reconciled.existingWorker,
			reconciled.observed,
			reconciled.result,
			answers,
			mode,
			asker,
			ctx.report
		);
		if (outcome.choice === WORKER_CHOICES.rename) {
			// Nothing has been created, so start again under the new name.
			return runSetup(ctx, { ...flags, name: outcome.newName }, mode, asker, presenter);
		}
		answers = outcome.answers;
		isWorkerReplaced = outcome.choice === WORKER_CHOICES.replace;
	}
	answers = await confirmAdoptions(reconciled.result, answers, mode, asker, ctx.report);

	presenter.stage('Plan');
	// If every value is already known and the file would come out the same, the plan says so
	// instead of listing a write.
	const predicted = applyAdoptions(
		manifest,
		reconciled.result,
		reconciled.observed,
		isWorkerReplaced
	);
	const deployConfig = await editedDeployConfig(ctx, predicted).then(
		(edited) => (edited.text === edited.before ? ('unchanged' as const) : ('write' as const)),
		() => 'write' as const
	);
	const plan = buildPlan(
		manifest,
		answers,
		reconciled.result,
		collected.discovery.policies,
		deployConfig
	);
	presenter.showPlan(plan);
	if (flags.isPlanOnly) {
		return { manifest, plan, checks: [], isApplied: false, handOff: [] };
	}
	if (!mode.isYes) {
		if (!mode.isInteractive) {
			throw new SetupError(
				ERROR_CODES.missingAnswer,
				'Applying the plan needs confirmation, and there is no terminal to ask on',
				{
					flag: '--yes',
					hint: 'Pass --yes to apply the plan above, or --plan to stop here.'
				}
			);
		}
		if (!(await asker.confirm({ message: 'Apply this plan?', isInitiallyYes: false }))) {
			throw new SetupError(ERROR_CODES.cancelled, 'Nothing was changed');
		}
	}
	manifest = ctx.save(
		withStepDone(
			applyAdoptions(manifest, reconciled.result, reconciled.observed, isWorkerReplaced),
			'plan'
		)
	);

	// Marked before anything changes, so a run that is interrupted leaves `provisioning` behind.
	manifest = await tagResources(ctx, manifest, TAGGABLE_KEYS, TAG_STATES.provisioning);

	presenter.stage('Provision');
	manifest = await presenter.task('Creating the database, bucket and queue', () =>
		provision(ctx, manifest, answers)
	);

	presenter.stage('Access');
	manifest = await presenter.task('Setting up the sign-in application', () =>
		access(ctx, manifest, answers)
	);

	presenter.stage('Deploy');
	manifest = await writeConfig(ctx, manifest);
	manifest = await presenter.task('Migrating, marking and deploying', () =>
		migrateMarkDeploy(ctx, manifest)
	);
	const deployed = manifest;
	const buildsLines = await presenter.task('Setting the Workers Builds variable', () =>
		configureBuilds(ctx, deployed)
	);

	presenter.stage('Verify');
	const verified = await presenter.task('Checking the live site', () => verify(ctx, manifest));
	manifest = verified.manifest;
	presenter.showChecks(verified.results);

	if (verified.results.every((check) => check.status !== CHECK_STATUSES.fail)) {
		manifest = await markConfigured(ctx, manifest);
	}

	const done = handOff(manifest);
	const lines = [...done.lines, ...buildsLines];
	presenter.showHandOff(lines);
	return {
		manifest: ctx.save(done.manifest),
		plan,
		checks: verified.results,
		isApplied: true,
		handOff: lines
	};
}

/** The line for Ctrl-C and failures: true because every step saves before the next begins. */
export function resumeNote(manifest: Manifest): string {
	const last = lastCompletedStep(manifest);
	return last
		? `Nothing was changed after "${last}"; re-run \`./setup\` to resume.`
		: 'Nothing was changed.';
}
