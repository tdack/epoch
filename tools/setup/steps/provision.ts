import type { StepContext } from '../context.ts';
import { withStepDone, type Manifest } from '../manifest.ts';
import { resourceNames } from '../names.ts';
import type { Answers } from '../options.ts';

/**
 * Creates what is absent. Each id goes into the manifest the moment it exists, so a crash between
 * two creations still leaves a record of the first. Adopted resources are already in the manifest.
 */
export async function provision(
	ctx: StepContext,
	manifest: Manifest,
	answers: Answers
): Promise<Manifest> {
	const names = resourceNames(manifest.workerName);
	let current = manifest;

	if (!current.resources.d1) {
		const created = await ctx.cf.createD1(names.d1, answers.d1Location);
		current = ctx.save({
			...current,
			resources: { ...current.resources, d1: { id: created.id, name: created.name } }
		});
	}
	if (!current.resources.r2) {
		await ctx.cf.createR2Bucket(names.r2, answers.r2Location, answers.r2Jurisdiction);
		current = ctx.save({ ...current, resources: { ...current.resources, r2: { name: names.r2 } } });
	}
	if (!current.resources.queue) {
		const created = await ctx.cf.createQueue(names.queue);
		current = ctx.save({
			...current,
			resources: { ...current.resources, queue: { id: created.id, name: created.name } }
		});
	}
	return ctx.save(withStepDone(current, 'provision'));
}
