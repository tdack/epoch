import { treeHandler } from '#lib/server/http/handler.js';
import { NameService } from '#lib/server/services/name-service.js';
import { nameImpactSchema } from '#lib/server/validation/schemas.js';

/** Preview a name change: exactly which records it would create, change or delete. Saves nothing. */
export const POST = treeHandler(
	{ failure: 'Failed to preview the name change', body: nameImpactSchema },
	async ({ db, ctx, treeId, body }) => {
		// A previewed create needs an id to plan against; it is discarded, and the save mints its own.
		const command =
			body.kind === 'create_name'
				? {
						kind: 'create_name' as const,
						personId: body.personId,
						nameId: 'preview',
						isPreferred: body.name.isPreferred,
						name: body.name as never
					}
				: body.kind === 'update_name'
					? {
							kind: 'update_name' as const,
							nameId: body.nameId,
							expectedVersion: body.version,
							name: body.name as never
						}
					: body.kind === 'delete_name'
						? { kind: 'delete_name' as const, nameId: body.nameId, expectedVersion: body.version }
						: {
								kind: 'set_preferred_name' as const,
								personId: body.personId,
								nameId: body.nameId,
								expectedVersion: body.version
							};
		return { impact: await new NameService(db).preview(treeId, command, ctx) };
	}
);
