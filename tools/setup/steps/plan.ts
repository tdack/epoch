import { resolveTypedConfirmation, type AnswerMode } from '../answers.ts';
import type { Asker } from '../asker.ts';
import type { Reporter } from '../context.ts';
import type { Manifest } from '../manifest.ts';
import { resourceNames } from '../names.ts';
import type { Answers } from '../options.ts';
import type { AccessPolicy } from '../policy.ts';
import {
	RESOURCE_STATES,
	adoptionsNeeded,
	type ReconcileResult,
	type ResourceKey
} from '../reconcile.ts';

/** Colour goes on the symbol, so the plan still reads under NO_COLOR. */
export const PLAN_SYMBOLS = { create: '+', adopt: '~', unchanged: '=', reference: '→' } as const;
type PlanSymbol = (typeof PLAN_SYMBOLS)[keyof typeof PLAN_SYMBOLS];

export interface PlanLine {
	symbol: PlanSymbol;
	text: string;
}

function lineFor(state: string, noun: string, name: string, extra = ''): PlanLine {
	switch (state) {
		case RESOURCE_STATES.absent:
			return { symbol: PLAN_SYMBOLS.create, text: `create ${noun} ${name}${extra}` };
		case RESOURCE_STATES.ours:
			return { symbol: PLAN_SYMBOLS.unchanged, text: `${noun} ${name} (already ours)` };
		default:
			return { symbol: PLAN_SYMBOLS.adopt, text: `adopt ${noun} ${name}, after you type its name` };
	}
}

export function buildPlan(
	manifest: Manifest,
	answers: Answers,
	result: ReconcileResult,
	policies: AccessPolicy[]
): PlanLine[] {
	const names = resourceNames(manifest.slug);
	const { reports } = result;
	const lines: PlanLine[] = [
		lineFor(
			reports.d1.state,
			'D1 database',
			names.d1,
			answers.d1Location ? ` in ${answers.d1Location}` : ''
		),
		lineFor(
			reports.r2.state,
			'R2 bucket',
			names.r2,
			[answers.r2Location, answers.r2Jurisdiction].filter(Boolean).length > 0
				? ` (${[answers.r2Location, answers.r2Jurisdiction].filter(Boolean).join(', ')})`
				: ''
		),
		lineFor(reports.queue.state, 'queue', names.queue)
	];
	for (const id of answers.policy.existingIds) {
		const policy = policies.find((p) => p.id === id);
		lines.push({
			symbol: PLAN_SYMBOLS.reference,
			text: `attach existing policy "${policy?.name ?? id}" (not edited)`
		});
	}
	if (answers.policy.isNewPolicy) {
		lines.push(
			reports.accessPolicy.state === RESOURCE_STATES.ours
				? { symbol: PLAN_SYMBOLS.unchanged, text: `policy "${names.accessPolicy}" (already ours)` }
				: reports.accessPolicy.state === RESOURCE_STATES.absent
					? {
							symbol: PLAN_SYMBOLS.create,
							text: `create policy "${names.accessPolicy}" (Allow: ${answers.ownerEmail} only)`
						}
					: {
							symbol: PLAN_SYMBOLS.reference,
							text: `attach the existing policy "${names.accessPolicy}" (not edited; it was not created by setup)`
						}
		);
	}
	lines.push(
		lineFor(
			reports.accessApp.state,
			'Access application',
			`"${reports.accessApp.name}" on ${answers.hostname}/login`
		),
		{ symbol: PLAN_SYMBOLS.create, text: 'write wrangler.deploy.jsonc (git-ignored)' },
		lineFor(
			reports.worker.state,
			'Worker',
			`${names.worker} with custom domain ${answers.hostname}`
		),
		{
			symbol: PLAN_SYMBOLS.create,
			text: 'apply every pending migration, then write the install markers'
		}
	);
	return lines;
}

/**
 * Adopting something the tool did not make, or re-attaching a lost checkout, needs the exact
 * resource name typed. The fingerprint is shown first so the user can see whose data this is.
 */
export async function confirmAdoptions(
	result: ReconcileResult,
	answers: Answers,
	mode: AnswerMode,
	asker: Asker,
	report: Reporter
): Promise<Answers> {
	const typed: Answers['typedAdoptions'] = { ...answers.typedAdoptions };
	for (const adoption of adoptionsNeeded(result)) {
		const existing = typed[adoption.key as ResourceKey];
		const resolution = resolveTypedConfirmation(adoption.name, existing, mode);
		if (resolution === 'confirmed') continue;
		const entry = result.reports[adoption.key];
		const heading =
			adoption.state === RESOURCE_STATES.orphaned
				? `${adoption.name} belongs to install ${entry.markerInstallId ?? result.installId}, which this checkout has no record of`
				: `${adoption.name} exists and carries no marker`;
		report.info([heading, ...entry.fingerprint.map((line) => `  ${line}`)].join('\n'));
		typed[adoption.key as ResourceKey] = await asker.text({
			message: `Type "${adoption.name}" to adopt it`,
			validate: (value) =>
				value.trim() === adoption.name ? undefined : `Type exactly ${adoption.name}`
		});
	}
	return { ...answers, typedAdoptions: typed };
}
