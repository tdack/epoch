import { expectedVersion, treeHandler } from '#lib/server/http/handler.js';
import { PersonService } from '#lib/server/services/person-service.js';
import { PersonPageService } from '#lib/server/services/person-page-service.js';
import { individualUpdateSchema } from '#lib/server/validation/schemas.js';

/** Everything the person page shows, from bounded reads: see `PersonPageDto`. */
export const GET = treeHandler(
	{ failure: 'Failed to load the person', params: ['personId'] },
	({ db, ctx, treeId, params }) => new PersonPageService(db).getPerson(treeId, params.personId, ctx)
);

export const PUT = treeHandler(
	{ failure: 'Failed to update individual', params: ['personId'], body: individualUpdateSchema },
	async ({ db, ctx, treeId, params, body }) => {
		const { givenName, surname, sex, birthDate, birthPlace, deathDate, deathPlace, version } = body;
		const { individual, change } = await new PersonService(db).update(
			treeId,
			params.personId,
			version,
			{ givenName, surname, sex, birthDate, birthPlace, deathDate, deathPlace },
			ctx
		);
		return { success: true, individual, change };
	}
);

export const DELETE = treeHandler(
	{ failure: 'Failed to delete individual', params: ['personId'] },
	async ({ db, ctx, treeId, params, url }) => {
		const { change } = await new PersonService(db).remove(
			treeId,
			params.personId,
			ctx,
			expectedVersion(url)
		);
		return { success: true, change };
	}
);
