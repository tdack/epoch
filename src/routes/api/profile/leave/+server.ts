import { renderFarewellEmail } from '#lib/server/email/farewell-template.js';
import { BindingUnavailableError } from '#lib/server/domain/errors.js';
import { apiHandler } from '#lib/server/http/handler.js';
import { ProfileService } from '#lib/server/services/profile-service.js';
import { leaveSchema } from '#lib/server/validation/schemas.js';

/**
 * Leaves Epoch (ADR-070). The farewell email is sent after the deletes commit and can never undo
 * them; without an `EMAIL` binding (local development) it is skipped.
 */
export const POST = apiHandler(
	{ failure: 'Failed to leave Epoch', body: leaveSchema },
	async ({ db, ctx, body, event, url }) => {
		const env = event.platform?.env;
		if (!env?.MEDIA_BUCKET) throw new BindingUnavailableError('MEDIA_BUCKET');
		const { to, ...farewell } = await new ProfileService(db).leave(
			body.confirmEmail,
			env.MEDIA_BUCKET,
			ctx
		);
		if (env.EMAIL && env.EPOCH_EMAIL_SENDER) {
			const { EMAIL: binding, EPOCH_EMAIL_SENDER: sender } = env;
			const { subject, html, text } = renderFarewellEmail({ ...farewell, origin: url.origin });
			const sending = binding
				.send({ from: { email: sender, name: 'Epoch' }, to, subject, html, text })
				.catch((error: unknown) => console.warn('Could not send the farewell email', error));
			const context = (event.platform as { context?: ExecutionContext } | undefined)?.context;
			if (context?.waitUntil) context.waitUntil(sending);
			else await sending;
		}
		return { didLeave: true };
	}
);
