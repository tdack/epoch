import type { WorkflowEvent, WorkflowStep } from 'cloudflare:workers';
import { getDb } from '../db';
import { assertSchemaCurrent } from '../db/schema-status';
import { DomainError } from '../domain/errors';
import { Logger } from '../logging/logger';
import { MATCH_PLACES_PER_STEP } from '../../shared/place-match';
import { PlaceMatchService, type MatchSelection } from '../services/place-match-service';
import { NonRetryableError, WorkflowEntrypoint } from './workflow-runtime';

export interface PlaceMatchPayload {
	treeId: string;
	/** Who started it; checked again here, and a run with no requester looks nothing up (ADR-015). */
	userId?: string;
}

export interface PlaceMatchResult {
	searched: number;
	matched: number;
}

/** A refusal (role, switched off) fails the instance at once; anything else may be retried. */
async function refusalsEndTheRun<T>(work: () => Promise<T>): Promise<T> {
	try {
		return await work();
	} catch (err) {
		if (err instanceof DomainError) throw new NonRetryableError(err.message);
		throw err;
	}
}

/**
 * Looks up a tree's unlocated places on Photon and keeps ranked candidates for review (ADR-078).
 *
 * Code outside a `step.do` runs again on every resume, so the places, the anchors and the bias
 * point are all decided inside the first step and read back from its stored result: a run whose
 * tree gains locations as it goes still asks the same questions of Photon.
 *
 * Places go ten to a step, with a one-second sleep between steps. One step per place would be a
 * lookup and a sleep each, and a 2,000-place run would then exceed the steps an instance may have;
 * `GeoService` spaces its own calls, so Photon still sees no more than about two a second.
 */
export class PlaceMatchWorkflow extends WorkflowEntrypoint<App.Platform['env'], PlaceMatchPayload> {
	async run(
		event: WorkflowEvent<PlaceMatchPayload>,
		step: WorkflowStep
	): Promise<PlaceMatchResult> {
		const { treeId, userId } = event.payload;
		const log = new Logger({
			treeId,
			userId,
			workflow: 'place-match',
			instanceId: event.instanceId
		});
		const service = new PlaceMatchService(getDb(this.env.DB), undefined, undefined, log);
		try {
			const selection: MatchSelection = await step.do(
				'select-places',
				{ retries: { limit: 1, delay: '5 seconds' } },
				() =>
					refusalsEndTheRun(async () => {
						await assertSchemaCurrent(this.env.DB);
						return service.selectForRun(treeId, userId);
					})
			);

			const total = { searched: 0, matched: 0 };
			for (
				let start = 0, index = 0;
				start < selection.places.length;
				start += MATCH_PLACES_PER_STEP, index++
			) {
				const batch = selection.places.slice(start, start + MATCH_PLACES_PER_STEP);
				const done = await step.do(
					`match-${index}`,
					{ retries: { limit: 2, delay: '10 seconds', backoff: 'exponential' } },
					// Logged inside the step: code outside one runs again on every resume.
					() =>
						refusalsEndTheRun(async () => {
							const result = await service.matchPlaces(treeId, batch, selection);
							log.info('Place match batch done', { batch: index, ...result });
							return result;
						})
				);
				total.searched += done.searched;
				total.matched += done.matched;
				if (start + MATCH_PLACES_PER_STEP < selection.places.length)
					await step.sleep(`pause-${index}`, '1 second');
			}

			await step.do('finish', async () => {
				await service.finish(treeId, 'done');
				log.info('Place match finished', { places: selection.places.length, ...total });
			});
			return total;
		} catch (err) {
			log.error('Place match failed', err);
			// Without this the tree's run would read "running" until it went stale.
			await step.do('mark-failed', () => service.finish(treeId, 'failed'));
			throw err;
		}
	}
}
