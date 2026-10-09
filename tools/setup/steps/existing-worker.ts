import { resolveTypedConfirmation, type AnswerMode } from '../answers.ts';
import type { Asker } from '../asker.ts';
import type { Reporter } from '../context.ts';
import { ERROR_CODES, SetupError } from '../errors.ts';
import { assertValidWorkerName, resourceNames, suggestAlternativeName } from '../names.ts';
import type { Answers } from '../options.ts';
import type { Observed, ObservedWorker, ReconcileResult } from '../reconcile.ts';
import { RESOURCE_STATES } from '../reconcile.ts';

export const WORKER_CHOICES = { rename: 'rename', adopt: 'adopt', replace: 'replace' } as const;
type WorkerChoice = (typeof WORKER_CHOICES)[keyof typeof WORKER_CHOICES];

export type WorkerOutcome =
	| { choice: typeof WORKER_CHOICES.rename; newName: string }
	| { choice: typeof WORKER_CHOICES.adopt | typeof WORKER_CHOICES.replace; answers: Answers };

/**
 * Adopting keeps the data, so it only makes sense when the Worker's own database is the one this
 * install would use. A Worker bound to some other database can be renamed away from or replaced.
 */
export function canAdoptWorker(worker: ObservedWorker, observed: Observed): boolean {
	return worker.boundD1Id === null || worker.boundD1Id === observed.d1?.id;
}

/** The "this is what will happen" panel for adopt and replace. Nothing in it is ever deleted. */
export function workerPanel(
	choice: typeof WORKER_CHOICES.adopt | typeof WORKER_CHOICES.replace,
	worker: ObservedWorker,
	observed: Observed,
	result: ReconcileResult,
	answers: Answers
): string[] {
	const names = resourceNames(answers.workerName);
	const lines = [
		`${choice === WORKER_CHOICES.replace ? 'Replacing' : 'Adopting'} Worker "${worker.name}" (last deployed ${worker.lastDeployedAt ?? 'unknown'})`,
		'',
		`  ~ Worker ${worker.name}  its code, bindings, vars and routes are overwritten; its secrets are kept`
	];
	const dropped = [
		worker.boundD1Id && worker.boundD1Id !== observed.d1?.id ? `D1 ${worker.boundD1Id}` : null,
		worker.boundR2Name && worker.boundR2Name !== names.r2 ? `R2 ${worker.boundR2Name}` : null,
		worker.boundQueueName && worker.boundQueueName !== names.queue
			? `queue ${worker.boundQueueName}`
			: null
	].filter((item): item is string => item !== null);
	for (const item of dropped)
		lines.push(`  - Bound ${item}  no longer bound to this Worker; NOT deleted, data kept`);
	const created = (['d1', 'r2', 'queue'] as const)
		.filter((key) => result.reports[key].state === RESOURCE_STATES.absent)
		.map((key) => result.reports[key].name);
	if (created.length > 0) lines.push(`  + Create  ${created.join(', ')}`);
	lines.push(
		`  ! Access  /login on ${answers.hostname} is protected from this deploy on`,
		'',
		'  Nothing is deleted. Undo: `wrangler rollback` redeploys the previous version (code only;',
		'  its bindings go back with it, and any new resources stay).'
	);
	return lines;
}

/**
 * A Worker with this name exists and is not ours. Rename is the default; adopt and replace each
 * need the name typed and a separate confirmation, and `--yes` satisfies neither.
 */
export async function resolveExistingWorker(
	worker: ObservedWorker,
	observed: Observed,
	result: ReconcileResult,
	answers: Answers,
	mode: AnswerMode,
	asker: Asker,
	report: Reporter
): Promise<WorkerOutcome> {
	if (mode.isYes) {
		throw new SetupError(
			ERROR_CODES.needsTypedConfirmation,
			`A Worker named "${worker.name}" already exists, and --yes will not choose what to do with it`,
			{
				hint: 'Pass another --name, or run in a terminal to adopt or replace it.'
			}
		);
	}
	if (!mode.isInteractive) {
		throw new SetupError(
			ERROR_CODES.missingAnswer,
			`A Worker named "${worker.name}" already exists, and there is no terminal to ask on`,
			{
				flag: '--name',
				hint: 'Pass another --name.'
			}
		);
	}
	report.info(
		[
			`A Worker named "${worker.name}" already exists and is not an install of this checkout`,
			...result.reports.worker.fingerprint.map((line) => `  ${line}`),
			`  ${result.reports.worker.reason}`
		].join('\n')
	);
	const canAdopt = canAdoptWorker(worker, observed);
	const choice = await asker.select<WorkerChoice>({
		message: 'What should setup do about it?',
		initial: WORKER_CHOICES.rename,
		choices: [
			{ value: WORKER_CHOICES.rename, label: 'Choose another name', hint: 'recommended' },
			...(canAdopt
				? [
						{
							value: WORKER_CHOICES.adopt,
							label: 'Adopt it',
							hint: 'keep its data and deploy over it'
						}
					]
				: []),
			{
				value: WORKER_CHOICES.replace,
				label: 'Replace it',
				hint: 'deploy Epoch over it with new resources'
			}
		]
	});
	if (choice === WORKER_CHOICES.rename) {
		const newName = (
			await asker.text({
				message: 'Another Worker name',
				initial: suggestAlternativeName(worker.name),
				validate: (value) => {
					try {
						assertValidWorkerName(value.trim());
					} catch (error) {
						return error instanceof SetupError ? error.hint : 'Not a valid Worker name';
					}
					return value.trim() === worker.name ? 'That is the name that is taken' : undefined;
				}
			})
		).trim();
		return { choice, newName };
	}
	report.info(workerPanel(choice, worker, observed, result, answers).join('\n'));
	if (resolveTypedConfirmation(worker.name, undefined, mode) === 'ask') {
		await asker.text({
			message: `Type "${worker.name}" to continue`,
			validate: (value) =>
				value.trim() === worker.name ? undefined : `Type exactly ${worker.name}`
		});
	}
	const verb = choice === WORKER_CHOICES.replace ? 'Overwrite' : 'Deploy over and adopt';
	if (
		!(await asker.confirm({ message: `${verb} Worker ${worker.name}?`, isInitiallyYes: false }))
	) {
		throw new SetupError(ERROR_CODES.cancelled, 'Nothing was changed');
	}
	return {
		choice,
		answers: { ...answers, typedAdoptions: { ...answers.typedAdoptions, worker: worker.name } }
	};
}
