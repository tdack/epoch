/**
 * Records fixtures/crossings.baseline.json. Skipped unless RECORD_CROSSING_BASELINE=1 so the
 * regression test never rewrites its own baseline; run it on purpose with `npm run tree:baseline`
 * after a deliberate layout improvement, and review the diff.
 */
import { describe, it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { countCrossings } from './contract';
import { layoutFocusView } from './index';
import { allTestGraphs } from './test-support';
import { CROSSING_CONFIGS, crossingKey } from './crossing-configs';

describe.skipIf(process.env.RECORD_CROSSING_BASELINE !== '1')('record crossing baseline', () => {
	it('writes the baseline file', () => {
		const baseline: Record<string, number> = {};
		for (const { name, graph } of allTestGraphs()) {
			graph.people.forEach((person, index) => {
				for (const config of CROSSING_CONFIGS) {
					baseline[crossingKey(name, index, config)] = countCrossings(layoutFocusView(graph, person.id, config));
				}
			});
		}
		const path = new URL('./fixtures/crossings.baseline.json', import.meta.url);
		writeFileSync(path, JSON.stringify(baseline, null, '\t') + '\n');
	});
});
