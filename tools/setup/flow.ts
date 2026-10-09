import type { AnswerMode } from './answers.ts';
import type { Asker } from './asker.ts';
import type { StepContext } from './context.ts';
import { ERROR_CODES, SetupError } from './errors.ts';
import { lastCompletedStep, withStepDone, type Manifest } from './manifest.ts';
import type { SetupFlags } from './options.ts';
import { access } from './steps/access.ts';
import { collect } from './steps/collect.ts';
import { handOff } from './steps/hand-off.ts';
import { migrateMarkDeploy } from './steps/migrate-mark-deploy.ts';
import { buildPlan, confirmAdoptions, type PlanLine } from './steps/plan.ts';
import { preflight } from './steps/preflight.ts';
import { provision } from './steps/provision.ts';
import { applyAdoptions, reconcileStep } from './steps/reconcile.ts';
import { signIn } from './steps/sign-in.ts';
import { verify, type CheckResult } from './steps/verify.ts';
import { writeConfig } from './steps/write-config.ts';

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

/** Plan steps 1 to 11. Each step reads the manifest and answers; only `collect` and the plan confirmation prompt. */
export async function runSetup(
	ctx: StepContext,
	flags: SetupFlags,
	mode: AnswerMode,
	asker: Asker,
	presenter: Presenter
): Promise<SetupResult> {
	presenter.stage('Preflight');
	const pre = preflight(ctx, flags);
	let manifest = pre.manifest;
	if (pre.isResume) presenter.showExisting(manifest);

	presenter.stage('Sign in');
	const signed = await presenter.task('Checking the Cloudflare sign-in', () =>
		signIn(ctx, manifest, flags)
	);
	manifest = signed.manifest;

	presenter.stage('Collect');
	const collected = await collect(ctx, manifest, flags, signed.identity, mode, asker);
	manifest = collected.manifest;
	let { answers } = collected;

	presenter.stage('Reconcile');
	const reconciled = await presenter.task('Checking what already exists', () =>
		reconcileStep(ctx, manifest, answers, pre.isResume)
	);
	manifest = reconciled.manifest;
	answers = await confirmAdoptions(reconciled.result, answers, mode, asker, ctx.report);

	presenter.stage('Plan');
	const plan = buildPlan(manifest, answers, reconciled.result, collected.discovery.policies);
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
		withStepDone(applyAdoptions(manifest, reconciled.result, reconciled.observed), 'plan')
	);

	presenter.stage('Provision');
	manifest = await presenter.task('Creating the database, bucket and queue', () =>
		provision(ctx, manifest, answers)
	);

	presenter.stage('Access');
	manifest = await presenter.task('Setting up the sign-in application', () =>
		access(ctx, manifest, answers)
	);

	presenter.stage('Deploy');
	manifest = writeConfig(ctx, manifest);
	manifest = await presenter.task('Migrating, marking and deploying', () =>
		migrateMarkDeploy(ctx, manifest)
	);

	presenter.stage('Verify');
	const verified = await presenter.task('Checking the live site', () => verify(ctx, manifest));
	manifest = verified.manifest;
	presenter.showChecks(verified.results);

	const done = handOff(manifest);
	presenter.showHandOff(done.lines);
	return {
		manifest: ctx.save(done.manifest),
		plan,
		checks: verified.results,
		isApplied: true,
		handOff: done.lines
	};
}

/** The line for Ctrl-C and failures: true because every step saves before the next begins. */
export function resumeNote(manifest: Manifest): string {
	const last = lastCompletedStep(manifest);
	return last
		? `Nothing was changed after "${last}"; re-run \`npm run setup\` to resume.`
		: 'Nothing was changed.';
}
