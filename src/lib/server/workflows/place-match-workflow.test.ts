import type { WorkflowEvent, WorkflowStep } from 'cloudflare:workers';
import { afterAll, beforeAll, afterEach, describe, expect, it, vi } from 'vitest';
import { UnauthorizedError } from '../domain/errors';
import { EXPECTED_MIGRATIONS } from '../db/schema-status';
import { MATCH_PLACES_PER_STEP } from '../../shared/place-match';
import { createTestDatabase, type TestDatabase } from '../testing/d1';
import { PlaceMatchService, type MatchSelection } from '../services/place-match-service';
import { PlaceMatchWorkflow, type PlaceMatchPayload } from './place-match-workflow';

// The runtime is absent under Vitest, as in the export workflow's test: the wrapper is mocked so
// the step logic runs against a fake base class and error.
vi.mock('./workflow-runtime', () => ({
	WorkflowEntrypoint: class {
		env: unknown;
		constructor(_ctx: unknown, env: unknown) {
			this.env = env;
		}
	},
	NonRetryableError: class NonRetryableError extends Error {
		constructor(message: string) {
			super(message);
			this.name = 'NonRetryableError';
		}
	}
}));

let t: TestDatabase;
beforeAll(async () => {
	t = await createTestDatabase();
	await t.d1
		.prepare(
			'CREATE TABLE IF NOT EXISTS d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL)'
		)
		.run();
	for (const name of EXPECTED_MIGRATIONS) {
		await t.d1.prepare('INSERT OR IGNORE INTO d1_migrations (name) VALUES (?)').bind(name).run();
	}
});
afterAll(async () => {
	await t.dispose();
});
afterEach(() => {
	vi.restoreAllMocks();
});

const payload: PlaceMatchPayload = { treeId: 'tree-1', userId: 'user-1' };
const selection = (count: number): MatchSelection => ({
	places: Array.from({ length: count }, (_, i) => ({ id: `p${i}`, name: `Place ${i}` })),
	centroid: null,
	anchors: []
});

/** A step that runs each callback once and records what the workflow asked for, in order. */
function recordingStep() {
	const log: string[] = [];
	const step = {
		do: async (name: string, configOrCallback: unknown, maybeCallback?: () => unknown) => {
			log.push(`do:${name}`);
			const callback = typeof configOrCallback === 'function' ? configOrCallback : maybeCallback;
			return (callback as () => unknown)();
		},
		sleep: async (name: string, duration: unknown) => {
			log.push(`sleep:${name}:${String(duration)}`);
		}
	} as unknown as WorkflowStep;
	return { log, step };
}

function workflow() {
	return new (
		PlaceMatchWorkflow as unknown as new (ctx: unknown, env: unknown) => PlaceMatchWorkflow
	)({}, { DB: t.d1 });
}
const run = (step: WorkflowStep) =>
	workflow().run({ payload, instanceId: 'x' } as unknown as WorkflowEvent<PlaceMatchPayload>, step);

describe('PlaceMatchWorkflow', () => {
	it('selects once, looks up ten places a step with a pause between, and finishes', async () => {
		vi.spyOn(PlaceMatchService.prototype, 'selectForRun').mockResolvedValue(selection(25));
		const batches: string[][] = [];
		vi.spyOn(PlaceMatchService.prototype, 'matchPlaces').mockImplementation(
			async (_tree, places) => {
				batches.push(places.map((p) => p.id));
				return { searched: places.length, matched: places.length - 1 };
			}
		);
		const finish = vi.spyOn(PlaceMatchService.prototype, 'finish').mockResolvedValue();
		const { log, step } = recordingStep();

		const result = await run(step);

		expect(result).toEqual({ searched: 25, matched: 22 });
		expect(batches.map((b) => b.length)).toEqual([MATCH_PLACES_PER_STEP, MATCH_PLACES_PER_STEP, 5]);
		expect(log).toEqual([
			'do:select-places',
			'do:match-0',
			'sleep:pause-0:1 second',
			'do:match-1',
			'sleep:pause-1:1 second',
			'do:match-2',
			'do:finish'
		]);
		expect(finish).toHaveBeenCalledWith('tree-1', 'done');
	});

	it('stays well inside the steps of an instance for the largest run', () => {
		// Two steps a batch, plus selecting and finishing, for a 2,000-place run.
		expect(Math.ceil(2000 / MATCH_PLACES_PER_STEP) * 2 + 2).toBeLessThan(1024);
	});

	it('finishes at once, with no lookups, when there is nothing to match', async () => {
		vi.spyOn(PlaceMatchService.prototype, 'selectForRun').mockResolvedValue(selection(0));
		const match = vi.spyOn(PlaceMatchService.prototype, 'matchPlaces');
		vi.spyOn(PlaceMatchService.prototype, 'finish').mockResolvedValue();
		const { log, step } = recordingStep();
		expect(await run(step)).toEqual({ searched: 0, matched: 0 });
		expect(match).not.toHaveBeenCalled();
		expect(log).toEqual(['do:select-places', 'do:finish']);
	});

	it('hands a refusal to the runtime as non-retryable, and marks the run failed', async () => {
		vi.spyOn(PlaceMatchService.prototype, 'selectForRun').mockRejectedValue(
			new UnauthorizedError('Forbidden: insufficient privileges')
		);
		const finish = vi.spyOn(PlaceMatchService.prototype, 'finish').mockResolvedValue();
		const { log, step } = recordingStep();
		await expect(run(step)).rejects.toMatchObject({ name: 'NonRetryableError' });
		expect(log).toEqual(['do:select-places', 'do:mark-failed']);
		expect(finish).toHaveBeenCalledWith('tree-1', 'failed');
	});

	it('marks the run failed when a lookup step gives up, so the tree is not locked', async () => {
		vi.spyOn(PlaceMatchService.prototype, 'selectForRun').mockResolvedValue(selection(3));
		vi.spyOn(PlaceMatchService.prototype, 'matchPlaces').mockRejectedValue(new Error('D1 down'));
		const finish = vi.spyOn(PlaceMatchService.prototype, 'finish').mockResolvedValue();
		const { step } = recordingStep();
		await expect(run(step)).rejects.toThrow('D1 down');
		expect(finish).toHaveBeenCalledWith('tree-1', 'failed');
	});

	it('refuses a run with no requester', async () => {
		const { step } = recordingStep();
		const finish = vi.spyOn(PlaceMatchService.prototype, 'finish').mockResolvedValue();
		await expect(
			workflow().run(
				{
					payload: { treeId: 'tree-1' },
					instanceId: 'x'
				} as unknown as WorkflowEvent<PlaceMatchPayload>,
				step
			)
		).rejects.toMatchObject({ name: 'NonRetryableError' });
		expect(finish).toHaveBeenCalledWith('tree-1', 'failed');
	});
});
