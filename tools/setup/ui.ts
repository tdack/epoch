import { styleText } from 'node:util';
import * as clack from '@clack/prompts';
import type { Asker } from './asker.ts';
import type { Reporter } from './context.ts';
import { FINDING_LEVELS, type Finding } from './doctor.ts';
import { ERROR_CODES, SetupError } from './errors.ts';
import type { Presenter } from './flow.ts';
import { PLAN_SYMBOLS, type PlanLine } from './steps/plan.ts';
import { CHECK_STATUSES, type CheckResult } from './steps/verify.ts';
import type { Manifest } from './manifest.ts';

/** The only module that imports clack. Under `--json` everything it prints goes to stderr, because stdout is the result object. */
export interface Ui {
	asker: Asker;
	presenter: Presenter;
	reporter: Reporter;
	intro(title: string): void;
	outro(message: string): void;
	error(message: string, hint?: string): void;
	showFindings(findings: Finding[]): void;
}

function unwrap<T>(value: T): Exclude<T, symbol> {
	if (clack.isCancel(value)) throw new SetupError(ERROR_CODES.cancelled, 'Cancelled');
	return value as Exclude<T, symbol>;
}

const SYMBOL_COLOURS = {
	[PLAN_SYMBOLS.create]: 'green',
	[PLAN_SYMBOLS.adopt]: 'yellow',
	[PLAN_SYMBOLS.unchanged]: 'dim',
	[PLAN_SYMBOLS.reference]: 'cyan',
	[PLAN_SYMBOLS.remove]: 'red'
} as const;

export function createUi(options: { isJson: boolean }): Ui {
	const output = options.isJson ? process.stderr : process.stdout;
	const opts = { output };

	const reporter: Reporter = {
		info: (message) => clack.log.info(message, opts),
		warn: (message) => clack.log.warn(message, opts)
	};

	const asker: Asker = {
		async select({ message, choices, initial }) {
			return unwrap(
				await clack.select({
					message,
					options: choices.map((c) => ({ value: c.value, label: c.label, hint: c.hint })) as never,
					initialValue: initial,
					output
				})
			) as never;
		},
		async multiselect({ message, choices, initial, isRequired }) {
			return unwrap(
				await clack.multiselect({
					message,
					options: choices.map((c) => ({ value: c.value, label: c.label, hint: c.hint })) as never,
					initialValues: initial,
					required: isRequired,
					output
				})
			) as never;
		},
		async text({ message, initial, placeholder, validate }) {
			return unwrap(
				await clack.text({
					message,
					initialValue: initial,
					placeholder,
					validate: validate ? (value) => validate(value ?? '') : undefined,
					output
				})
			);
		},
		async confirm({ message, isInitiallyYes }) {
			return unwrap(await clack.confirm({ message, initialValue: isInitiallyYes, output }));
		}
	};

	const presenter: Presenter = {
		stage: (title) => clack.log.step(styleText('bold', title), opts),
		async task(label, work) {
			const spinner = clack.spinner({ output });
			spinner.start(label);
			try {
				const value = await work();
				spinner.stop(label);
				return value;
			} catch (error) {
				spinner.error(label);
				throw error;
			}
		},
		showPlan(lines: PlanLine[]) {
			const body = lines
				.map((line) => `${styleText(SYMBOL_COLOURS[line.symbol], line.symbol)} ${line.text}`)
				.join('\n');
			clack.note(body, 'Plan', opts);
		},
		showChecks(results: CheckResult[]) {
			for (const check of results) {
				if (check.status === CHECK_STATUSES.pass)
					clack.log.success(`${check.name}: ${check.detail}`, opts);
				else if (check.status === CHECK_STATUSES.skip)
					clack.log.info(`${check.name}: ${check.detail}`, opts);
				else clack.log.error(`${check.name}: ${check.detail}\n  Fix: ${check.fix}`, opts);
			}
		},
		showHandOff: (lines) => clack.note(lines.join('\n'), 'Done', opts),
		showExisting(manifest: Manifest) {
			clack.note(
				[
					`workerName ${manifest.workerName}`,
					`host ${manifest.hostname ?? 'not chosen yet'}`,
					`steps done: ${manifest.completedSteps.join(', ') || 'none'}`
				].join('\n'),
				'An install already exists here; resuming or updating it',
				opts
			);
		}
	};

	return {
		asker,
		presenter,
		reporter,
		intro: (title) => clack.intro(styleText('inverse', ` ${title} `), opts),
		outro: (message) => clack.outro(message, opts),
		error(message, hint) {
			clack.log.error(hint ? `${message}\n${hint}` : message, opts);
		},
		showFindings(findings) {
			for (const finding of findings) {
				if (finding.level === FINDING_LEVELS.ok) clack.log.success(finding.text, opts);
				else if (finding.level === FINDING_LEVELS.warn) clack.log.warn(finding.text, opts);
				else clack.log.error(finding.text, opts);
			}
		}
	};
}
