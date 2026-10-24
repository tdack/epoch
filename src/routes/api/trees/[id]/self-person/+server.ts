import { treeHandler } from '#lib/server/http/handler.js';
import { TreeService } from '#lib/server/services/tree-service.js';
import { selfPersonSchema } from '#lib/server/validation/schemas.js';

/** The signed-in member's own "this is me" person in this tree (`null` clears it). */
export const PUT = treeHandler(
	{ failure: 'Failed to save who you are', body: selfPersonSchema },
	({ db, ctx, treeId, body }) => new TreeService(db).setSelfPerson(treeId, body.personId, ctx)
);
