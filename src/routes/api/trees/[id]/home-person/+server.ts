import { treeHandler } from '#lib/server/http/handler.js';
import { TreeService } from '#lib/server/services/tree-service.js';
import { homePersonSchema } from '#lib/server/validation/schemas.js';

/** The signed-in member's own starting person in this tree (`null` clears it). */
export const PUT = treeHandler(
	{ failure: 'Failed to save the starting person', body: homePersonSchema },
	({ db, ctx, treeId, body }) => new TreeService(db).setHomePerson(treeId, body.personId, ctx)
);
