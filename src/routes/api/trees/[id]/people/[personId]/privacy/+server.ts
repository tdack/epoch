import { treeHandler } from '#lib/server/http/handler.js';
import { PrivacyService } from '#lib/server/services/privacy-service.js';
import { personPrivacySchema } from '#lib/server/validation/schemas.js';

/** Force a person public or private, or hand them back to the derived living state. A manager's action. */
export const PUT = treeHandler(
	{
		failure: 'Failed to change the privacy of the person',
		params: ['personId'],
		body: personPrivacySchema
	},
	async ({ db, ctx, treeId, params, body: { privacy, version } }) => {
		const { change } = await new PrivacyService(db).setPersonPrivacy(
			treeId,
			params.personId,
			privacy,
			version,
			ctx
		);
		return { change };
	}
);
