import type { RequestHandler } from '@sveltejs/kit';
import { getDb } from '#lib/server/db/index.js';
import { GenealogyService } from '#lib/server/services/genealogy-service.js';
import { errorResponse } from '#lib/server/http/error-response.js';
import { individualUpdateSchema } from '#lib/server/validation/schemas.js';
import { parseBody } from '#lib/server/validation/index.js';

export const GET: RequestHandler = async ({ params, locals, platform }) => {
	if (!locals.user) {
		return Response.json({ error: 'Authentication required' }, { status: 401 });
	}

	const { id: treeId, individualId } = params;
	if (!treeId || !individualId) {
		return Response.json({ error: 'Tree ID and Individual ID required' }, { status: 400 });
	}

	if (!platform?.env?.DB) {
		return Response.json({ error: 'Database binding unavailable' }, { status: 500 });
	}

	try {
		const db = getDb(platform.env.DB);
		const service = new GenealogyService(db);
		const individual = await service.getIndividual(treeId, individualId, {
			user: locals.user,
			correlationId: locals.correlationId
		});

		return Response.json({ individual });
	} catch (err) {
		return errorResponse(err, 'Failed to get individual');
	}
};

export const PUT: RequestHandler = async ({ params, request, locals, platform }) => {
	if (!locals.user) {
		return Response.json({ error: 'Authentication required' }, { status: 401 });
	}

	const { id: treeId, individualId } = params;
	if (!treeId || !individualId) {
		return Response.json({ error: 'Tree ID and Individual ID required' }, { status: 400 });
	}

	if (!platform?.env?.DB) {
		return Response.json({ error: 'Database binding unavailable' }, { status: 500 });
	}

	try {
		const body = parseBody(individualUpdateSchema, await request.json().catch(() => ({})));
		const { givenName, surname, sex, birthDate, birthPlace, deathDate, deathPlace, version } = body;

		const db = getDb(platform.env.DB);
		const service = new GenealogyService(db);

		const { individual: updated, change } = await service.updateIndividual(
			treeId,
			individualId,
			version,
			{
				givenName,
				surname,
				sex,
				birthDate,
				birthPlace,
				deathDate,
				deathPlace
			},
			{
				user: locals.user,
				correlationId: locals.correlationId
			}
		);

		return Response.json({ success: true, individual: updated, change });
	} catch (err) {
		return errorResponse(err, 'Failed to update individual');
	}
};

export const DELETE: RequestHandler = async ({ params, url, locals, platform }) => {
	if (!locals.user) {
		return Response.json({ error: 'Authentication required' }, { status: 401 });
	}

	const { id: treeId, individualId } = params;
	if (!treeId || !individualId) {
		return Response.json({ error: 'Tree ID and Individual ID required' }, { status: 400 });
	}

	if (!platform?.env?.DB) {
		return Response.json({ error: 'Database binding unavailable' }, { status: 500 });
	}

	try {
		const db = getDb(platform.env.DB);
		const service = new GenealogyService(db);

		const versionParam = url.searchParams.get('version');
		const { change } = await service.deleteIndividual(
			treeId,
			individualId,
			{ user: locals.user, correlationId: locals.correlationId },
			versionParam === null ? undefined : Number(versionParam)
		);

		return Response.json({ success: true, change });
	} catch (err) {
		return errorResponse(err, 'Failed to delete individual');
	}
};
