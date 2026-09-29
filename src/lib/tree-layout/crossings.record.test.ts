/**
 * Records fixtures/crossings.baseline.json through a file snapshot. Skipped unless
 * RECORD_CROSSING_BASELINE=1 so the regression test can never rewrite its own baseline; run it
 * on purpose with `npm run tree:baseline` after a deliberate layout improvement, then review
 * the diff.
 */
import { describe, expect, it } from 'vitest';
import { countCrossings } from './contract';
import { layoutFocusView } from './index';
import { allTestGraphs } from './test-support';
import { CROSSING_CONFIGS, crossingKey } from './crossing-configs';

describe.skipIf(process.env.RECORD_CROSSING_BASELINE !== '1')('record crossing baseline', () => {
	it('writes the baseline file', async () => {
		const baseline: Record<string, number> = {};
		for (const { name, graph } of allTestGraphs()) {
			graph.people.forEach((person, index) => {
				for (const config of CROSSING_CONFIGS) {
					baseline[crossingKey(name, index, config)] = countCrossings(layoutFocusView(graph, person.id, config));
				}
			});
		}
		await expect(JSON.stringify(baseline, null, '\t') + '\n').toMatchFileSnapshot(
			'./fixtures/crossings.baseline.json'
		);
	});
});
