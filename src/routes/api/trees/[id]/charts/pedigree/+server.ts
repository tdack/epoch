import { treeHandler } from '#lib/server/http/handler.js';
import { ChartService } from '#lib/server/services/chart-service.js';
import { DEFAULT_CHART_GENERATIONS } from '#lib/shared/charts.js';
import { ValidationError } from '#lib/server/domain/errors.js';

/** `?person=<id>&generations=<n>`: the pedigree chart's data (see `PedigreeDto`). */
export const GET = treeHandler(
	{ allowPublicVisitor: true, failure: 'Failed to load the chart' },
	({ db, ctx, treeId, url }) => {
		const person = url.searchParams.get('person');
		if (!person) throw new ValidationError('person is required');
		const generations = Number(url.searchParams.get('generations') ?? DEFAULT_CHART_GENERATIONS);
		return new ChartService(db).pedigree(treeId, person, generations, ctx);
	}
);
