import type { StepContext } from '../context.ts';
import { withStepDone, type Manifest } from '../manifest.ts';
import { tagConfigured } from '../tags.ts';

/**
 * Plan step 10b: once verify has passed, every resource this run tagged becomes `configured`, so a
 * half-finished install shows in the dashboard and can be filtered on without the manifest.
 */
export async function markConfigured(ctx: StepContext, manifest: Manifest): Promise<Manifest> {
	const tagged = await tagConfigured(ctx, manifest);
	return ctx.save(withStepDone(tagged, 'mark-configured'));
}
